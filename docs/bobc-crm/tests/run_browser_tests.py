#!/usr/bin/env python3
"""Reproducible Chromium/IndexedDB audit; no application backend is introduced."""
import argparse
import csv
import io
import json
import mimetypes
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright

PROJECT = Path(__file__).resolve().parents[1]
BASE_SOURCE_COMMIT = "309278c9081dcf3aef672c7128f862f46555394b"
SOURCE_COMMIT = os.environ.get("GITHUB_SHA")
PUBLIC_URL = os.environ.get("BOBC_PUBLIC_URL")
VIRTUAL_ORIGIN = None


class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT), **kwargs)

    def log_message(self, *args):
        pass


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def harness(context, origin):
    install_virtual_server(context, origin)
    page = context.new_page()
    page.goto(origin + "/tests/browser.html")
    page.wait_for_function("Boolean(window.qa)")
    return page


def install_virtual_server(context, origin):
    if origin != VIRTUAL_ORIGIN:
        return

    def serve(route):
        path = (PROJECT / unquote(urlsplit(route.request.url).path).lstrip("/")).resolve()
        if path.is_dir():
            path /= "index.html"
        if not path.is_relative_to(PROJECT) or not path.is_file():
            route.fulfill(status=404, body="Not found")
            return
        route.fulfill(status=200, body=path.read_bytes(), content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream", headers={"Cache-Control": "no-store"})

    context.route(origin + "/**", serve)


def result(name, callback):
    start = time.monotonic()
    try:
        detail = callback()
        return {"name": name, "passed": True, "durationMs": round((time.monotonic() - start) * 1000), "detail": detail}
    except Exception as error:
        return {"name": name, "passed": False, "durationMs": round((time.monotonic() - start) * 1000), "error": str(error)}


def multipage(browser, origin):
    results = []
    with browser.new_context() as context:
        first, second = harness(context, origin), harness(context, origin)

        def blocked():
            first.evaluate("qa.seedV1()")
            second.evaluate("qa.blockedUpgrade()")
            first.evaluate("qa.closeHeld()")
            state = second.evaluate("qa.verifyInterruptedUpgrade()")
            check(state == {"version": 1, "stores": 51}, "Rejected upgrade changed the legacy database")
            check(second.evaluate("qa.verifyPostBlocked()") == {"version": 2, "stores": 96}, "Clean upgrade after blocker closed failed")
            return "Two real pages; blocked request rejected, v1 preserved, retry upgrades to v2"

        results.append(result("indexeddb/multipage-blocked-upgrade-retry-no-late-connection", blocked))

        def versionchange():
            first.evaluate("qa.holdManaged()")
            check(second.evaluate("qa.bumpVersion()") == 3, "External upgrade did not complete")
            check(first.evaluate("qa.heldClosed()"), "Versionchange did not close the managed database")
            first.evaluate("qa.closeHeld()")
            second.evaluate("qa.erase()")
            return "Managed v2 connection closed when another page requested version 3"

        results.append(result("indexeddb/multipage-versionchange-auto-close", versionchange))
    return results


def wait_initialized(page):
    page.wait_for_function("document.getElementById('status').textContent.includes('96 entidades')")


def module_entity(page, area, entity):
    area_input = page.locator("#crm-area")
    if area_input.input_value() != area:
        area_input.select_option(label=area)
        page.wait_for_function("area => document.getElementById('crm-area')?.value === area", arg=area)
    page.locator("#crm-entity").select_option(entity)
    page.wait_for_function("entity => document.getElementById('crm-entity')?.value === entity", arg=entity)
    page.wait_for_function("Boolean(document.querySelector('#crm-module-rows .record'))")


def smoke(browser, origin, name, options, artifact_dir):
    with browser.new_context(accept_downloads=True, **options) as context:
        install_virtual_server(context, origin)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(origin + "/")
        wait_initialized(page)
        check(page.locator("[data-tab]").count() == 5, "Expected five navigation tabs")
        page.locator("#new").click()
        party_name = '=Cliente "<svg/onload=window.__xss=1>" ' + name
        page.locator("#personName").fill(party_name)
        page.locator("#personType").select_option("ORGANIZATION")
        page.locator("#form button.primary").click()
        page.wait_for_function("document.getElementById('count').textContent === '1'")
        check(page.locator("#records b").inner_text() == party_name, "New Party text differs")
        check(page.evaluate("window.__xss === undefined"), "Party text executed HTML")
        page.locator("#search").fill("no-such-person")
        page.wait_for_function("document.getElementById('count').textContent === '0'")
        page.locator("#search").fill("Cliente")
        page.wait_for_function("document.getElementById('count').textContent === '1'")
        page.locator("[data-convert]").click()
        page.wait_for_function("document.querySelector('#records small').textContent.includes('Cliente')")
        check(page.locator("[data-convert]").count() == 0, "Conversion button still visible")

        for tab in ["inicio", "relaciones", "comercial", "reportes", "mas"]:
            page.locator(f'[data-tab="{tab}"]').click()
            page.wait_for_function("tab => document.querySelector(`[data-tab='${tab}']`).classList.contains('active')", arg=tab)
            check(page.locator(f'[data-tab="{tab}"]').get_attribute("aria-current") == "page", "Current navigation state inaccessible")

        page.wait_for_selector("#crm-area")
        areas = page.evaluate("import('./js/modules/module-manager.js').then(m => m.MODULE_AREAS)")
        visited = 0
        for area, entities in areas.items():
            for entity in entities:
                module_entity(page, area, entity)
                page.wait_for_function("Boolean(document.querySelector('#crm-module-form button[type=submit]'))")
                check(page.locator("#crm-fields [name]").count() > 0, f"{entity}: no form fields")
                visited += 1
        check(visited == 37 and len(areas) == 8, "Not all eight modules / 37 forms visited")
        module_entity(page, "Proyectos", "projects")
        page.locator('#crm-module-form [name="name"]').fill("Proyecto " + name)
        party_id = page.locator('#crm-module-form [name="party_id"] option').nth(1).get_attribute("value")
        page.locator('#crm-module-form [name="party_id"]').select_option(party_id)
        page.locator("#crm-module-form button[type=submit]").click()
        page.wait_for_function("document.getElementById('crm-module-rows').textContent.includes('1 registros')")
        module_entity(page, "Proyectos", "project_phases")
        page.locator('#crm-module-form [name="name"]').fill("Fase inicial")
        project_id = page.locator('#crm-module-form [name="project_id"] option').nth(1).get_attribute("value")
        page.locator('#crm-module-form [name="project_id"]').select_option(project_id)
        page.locator("#crm-module-form button[type=submit]").click()
        page.wait_for_function("document.getElementById('crm-module-rows').textContent.includes('1 registros')")

        page.locator('[data-tab="reportes"]').click()
        with page.expect_download() as download:
            page.locator('[data-export="csv"]').click()
        csv_path = artifact_dir / (name + ".csv")
        download.value.save_as(str(csv_path))
        csv_rows = list(csv.reader(io.StringIO(csv_path.read_text(encoding="utf-8-sig"))))
        check(csv_rows[0] == ["Nombre", "Tipo", "Estado"], "CSV columns changed")
        check(csv_rows[1] == ["'" + party_name, "ORGANIZATION", "CUSTOMER"], "CSV quoted Unicode/text or formula protection failed")

        with page.expect_download() as download:
            page.locator("#backup").click()
        backup_path = artifact_dir / (name + ".json")
        download.value.save_as(str(backup_path))
        backup = json.loads(backup_path.read_text())
        check(backup.get("schemaVersion") == 2 and backup.get("backupVersion") == 2, "UI downloaded obsolete backup version")
        check(len(backup["records"]) == 96, "UI backup lacks stores")
        check(backup["records"]["parties"][0]["display_name"] == party_name, "JSON backup altered user text")
        check(backup["records"]["projects"][0]["party_id"] == party_id, "Project FK missing in UI export")
        check(backup["records"]["project_phases"][0]["project_id"] == project_id, "Phase FK missing in UI export")

        # Restore the actual downloaded file, using the application's existing confirmation.
        page.on("dialog", lambda dialog: dialog.accept())
        page.locator("#file").set_input_files(str(backup_path))
        page.wait_for_function("document.getElementById('notice').textContent.includes('Datos restaurados')")
        page.locator('[data-tab="relaciones"]').click()
        page.reload()
        wait_initialized(page)
        page.wait_for_function("document.getElementById('count').textContent === '1'")
        check(page.locator("#records b").inner_text() == party_name, "Reload lost Party")
        viewport = page.viewport_size
        check(page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), f"Horizontal overflow at {viewport}")
        page.close()
        page = context.new_page()
        page.goto(origin + "/")
        wait_initialized(page)
        page.wait_for_function("document.getElementById('count').textContent === '1'")
        check(page.locator("#records b").inner_text() == party_name, "Close/open lost Party")
        check(not errors, "Browser errors: " + "; ".join(errors))
        return {"viewport": viewport, "emulation": name, "tabs": 5, "areas": 8, "entityForms": visited, "realDevice": False}


def public_check(playwright, executable):
    if not PUBLIC_URL:
        return {"executed": False, "reason": "BOBC_PUBLIC_URL no configurada; la publicación web independiente está pendiente"}
    proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    launch_options = {"headless": True, "executable_path": executable, "args": ["--no-sandbox"]}
    if proxy_url:
        parsed = urlsplit(proxy_url)
        proxy = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
        if parsed.username:
            proxy["username"] = parsed.username
        if parsed.password:
            proxy["password"] = parsed.password
        launch_options["proxy"] = proxy
    start = time.monotonic()
    with playwright.chromium.launch(**launch_options) as browser:
        page = browser.new_page()
        try:
            response = page.goto(PUBLIC_URL, wait_until="domcontentloaded", timeout=15000)
            remaining = max(1, int(15000 - (time.monotonic() - start) * 1000))
            page.wait_for_function("!document.getElementById('status').textContent.includes('Inicializando')", timeout=remaining)
            status = page.locator("#status").inner_text()
            return {"url": PUBLIC_URL, "executed": True, "passed": bool(response and response.ok and "96 entidades" in status), "httpStatus": response.status if response else None, "status": status}
        except Exception as error:
            return {"url": PUBLIC_URL, "executed": False, "passed": None, "error": str(error).split("Call log:")[0].strip()}


def main():
    global VIRTUAL_ORIGIN
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="Write machine-readable results to this file")
    parser.add_argument("--chromium", default=shutil.which("chromium") or shutil.which("chromium-browser"))
    parser.add_argument("--skip-public", action="store_true", help="Skip the one bounded Pages network probe on repeat runs")
    args = parser.parse_args()
    check(args.chromium, "Chromium executable not found; pass --chromium /path/to/chromium")
    server = None
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    except PermissionError:
        # Restricted executors can block socket binding. Browser responses are
        # then fulfilled from these same files; native IndexedDB still runs.
        VIRTUAL_ORIGIN = "http://127.0.0.1:47981"
    if server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}" if server else VIRTUAL_ORIGIN
    report = {"sourceCommit": SOURCE_COMMIT, "baseSourceCommit": BASE_SOURCE_COMMIT, "testedCode": "GitHub Actions checkout" if SOURCE_COMMIT else "local working copy (no CI commit supplied)", "browser": "Chromium", "realDevicesTested": False, "results": []}
    report["transport"] = "stdlib HTTP server" if server else "Playwright local route (no network)"
    try:
        with sync_playwright() as p, tempfile.TemporaryDirectory(prefix="bobc-crm-qa-") as temp_dir:
            with p.chromium.launch(headless=True, executable_path=args.chromium, args=["--no-sandbox"]) as browser:
                report["browserVersion"] = browser.version
                with browser.new_context() as context:
                    page = harness(context, origin)
                    report["results"].extend(page.evaluate("qa.runCore()"))
                report["results"].extend(multipage(browser, origin))
                profiles = [("Android-Pixel7", dict(p.devices["Pixel 7"])), ("iPhone13-Chromium-emulation", dict(p.devices["iPhone 13"])), ("Desktop", {"viewport": {"width": 1280, "height": 900}, "device_scale_factor": 1, "is_mobile": False, "has_touch": False})]
                for name, options in profiles:
                    options.pop("default_browser_type", None)
                    report["results"].append(result("ui/" + name, lambda n=name, o=options: smoke(browser, origin, n, o, Path(temp_dir))))
            report["publicPages"] = {"executed": False, "reason": "Skipped by --skip-public"} if args.skip_public else public_check(p, args.chromium)
    except Exception as error:
        report["executionError"] = str(error).split("Call log:")[0].strip()
        report["publicPages"] = {"executed": False, "reason": "Local browser runtime unavailable"}
    finally:
        if server:
            server.shutdown()
            server.server_close()
    report["passed"] = sum(r["passed"] for r in report["results"])
    report["failed"] = len(report["results"]) - report["passed"]
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    for r in report["results"]:
        print(("PASS " if r["passed"] else "FAIL ") + r["name"])
        if not r["passed"]:
            print("  " + r["error"].replace("\n", "\n  "))
    print(f"{report['passed']} passed, {report['failed']} failed; public Pages: " + json.dumps(report["publicPages"], ensure_ascii=False))
    if report.get("executionError"):
        print("NOT EXECUTED: " + report["executionError"])
    return 1 if report["failed"] or report.get("executionError") else 0


if __name__ == "__main__":
    raise SystemExit(main())
