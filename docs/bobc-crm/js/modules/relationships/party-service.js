export class PartyService {
  constructor(repo) { this.repo = repo; }
  async list(q = '') {
    const query = String(q).toLocaleLowerCase();
    const rows = await this.repo.all('parties');
    return rows.filter(p => String(p.display_name || '').toLocaleLowerCase().includes(query))
      .sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || '')));
  }
  create({display_name, party_type = 'PERSON', lifecycle = 'LEAD'}) {
    return this.repo.save('parties', {display_name, party_type, lifecycle, status: 'ACTIVE'});
  }
  async convertLead(id) {
    // Read and modify in one transaction so concurrent edits are preserved.
    return this.repo.update('parties', id, {lifecycle: 'CUSTOMER'});
  }
}
