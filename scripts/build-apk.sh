#!/usr/bin/env bash
set -euo pipefail

# Run from any directory. SDK/JDK installation and licenses are prerequisites.
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
gradle_version='8.9'
# Official Gradle release: https://github.com/gradle/gradle-distributions/releases/tag/v8.9.0
gradle_sha256='d725d707bfabd4dfdc958c624003b3c80accc03f7037b5122c4b1d0ef15cecab'

fail() { printf '%s\n' "$*" >&2; exit 1; }

javac_command="${JAVA_HOME:+${JAVA_HOME}/bin/}javac"
command -v "$javac_command" >/dev/null 2>&1 || fail 'Falta JDK 17 (javac). Instala JDK 17 y configura JAVA_HOME.'
javac_version="$("$javac_command" -version 2>&1)"
[[ "$javac_version" == 'javac 17.'* ]] || fail "Se requiere JDK 17; encontrado: $javac_version"

sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$sdk_dir" ]] || fail 'Configura ANDROID_HOME con la ruta del Android SDK.'
[[ -f "$sdk_dir/platforms/android-35/android.jar" ]] || fail 'Falta SDK Platform 35. Ejecuta sdkmanager "platforms;android-35".'
[[ -f "$sdk_dir/build-tools/35.0.0/aapt2" ]] || fail 'Faltan Build Tools 35.0.0. Ejecuta sdkmanager "build-tools;35.0.0".'
[[ -x "$sdk_dir/build-tools/35.0.0/apksigner" ]] || fail 'Falta apksigner en Build Tools 35.0.0.'

gradle_command=''
if command -v gradle >/dev/null 2>&1; then
    installed_version="$(gradle --version | awk '/^Gradle / { print $2; exit }')"
    if [[ "$installed_version" == "$gradle_version" ]]; then
        gradle_command="$(command -v gradle)"
    fi
fi

if [[ -z "$gradle_command" ]]; then
    build_cache="${BOBC_BUILD_CACHE:-$project_dir/.build-tools}"
    gradle_command="$build_cache/gradle-$gradle_version/bin/gradle"
    if [[ ! -x "$gradle_command" ]]; then
        command -v curl >/dev/null 2>&1 || fail 'Falta curl para descargar Gradle 8.9.'
        command -v unzip >/dev/null 2>&1 || fail 'Falta unzip para instalar Gradle 8.9.'
        if command -v sha256sum >/dev/null 2>&1; then
            checksum_command=(sha256sum)
        elif command -v shasum >/dev/null 2>&1; then
            checksum_command=(shasum -a 256)
        else
            fail 'Falta sha256sum o shasum para verificar Gradle.'
        fi
        mkdir -p "$build_cache"
        download_dir="$(mktemp -d "$build_cache/gradle-download.XXXXXX")"
        trap 'rm -rf -- "$download_dir"' EXIT
        printf '%s\n' 'Descargando Gradle 8.9 con verificación SHA-256…'
        curl --fail --location --proto '=https' --proto-redir '=https' \
            --retry 3 --connect-timeout 20 \
            --output "$download_dir/gradle.zip" \
            "https://services.gradle.org/distributions/gradle-$gradle_version-bin.zip"
        actual_sha256="$("${checksum_command[@]}" "$download_dir/gradle.zip" | awk '{ print $1 }')"
        [[ "$actual_sha256" == "$gradle_sha256" ]] || fail 'El SHA-256 de Gradle no coincide; no se ejecutará la descarga.'
        unzip -q "$download_dir/gradle.zip" -d "$download_dir"
        [[ ! -e "$build_cache/gradle-$gradle_version" ]] || fail 'La caché de Gradle está incompleta. Usa otro BOBC_BUILD_CACHE.'
        mv "$download_dir/gradle-$gradle_version" "$build_cache/"
        rm -rf -- "$download_dir"
        trap - EXIT
    fi
fi

"$gradle_command" --no-daemon --console=plain -p "$project_dir/android" \
    :app:assembleDebug :app:lintDebug

"$sdk_dir/build-tools/35.0.0/apksigner" verify --verbose \
    "$project_dir/android/app/build/outputs/apk/debug/app-debug.apk"

mkdir -p "$project_dir/dist"
apk_name='BOBC-CRM-0.4.1-debug.apk'
cp "$project_dir/android/app/build/outputs/apk/debug/app-debug.apk" "$project_dir/dist/$apk_name"
if command -v sha256sum >/dev/null 2>&1; then
    (cd "$project_dir/dist" && sha256sum "$apk_name" > "$apk_name.sha256")
elif command -v shasum >/dev/null 2>&1; then
    (cd "$project_dir/dist" && shasum -a 256 "$apk_name" > "$apk_name.sha256")
else
    fail 'Falta sha256sum o shasum para generar el checksum del APK.'
fi
printf 'APK de pruebas: %s\n' "$project_dir/dist/$apk_name"
printf 'Informe Android Lint: %s\n' "$project_dir/android/app/build/reports/lint-results-debug.html"
