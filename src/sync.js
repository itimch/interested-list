const { getRecentlyContactedLeads, mapLifecycleToStatus } = require('./hubspot');
const { upsertLead } = require('./notion');

async function syncHubSpotToNotion(limit = 100) {
  console.log(`[sync] Starting HubSpot → Notion sync (limit: ${limit})`);
  const contacts = await getRecentlyContactedLeads(limit);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const contact of contacts) {
    const p = contact.properties;
    const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email;

    // Skip internal/candidate contacts (gmail addresses used for SDR screening)
    if (isInternalContact(p.email)) continue;

    try {
      const result = await upsertLead({
        hubspotId: contact.id,
        name,
        company: p.company || '',
        email: p.email,
        status: mapLifecycleToStatus(p),
        source: 'HubSpot',
        lastContacted: p.notes_last_contacted,
        nextFollowUp: p.notes_next_activity_date,
      });

      if (result.action === 'created') created++;
      else updated++;
    } catch (err) {
      console.error(`[sync] Error upserting ${p.email}:`, err.message);
      errors++;
    }
  }

  const summary = { total: contacts.length, created, updated, errors };
  console.log('[sync] Done:', summary);
  return summary;
}

function isInternalContact(email) {
  if (!email) return true;
  const internalDomains = ['sequenceminds.com'];
  const domain = email.split('@')[1] || '';
  if (internalDomains.includes(domain)) return true;

  // Skip obvious SDR candidate addresses (free email, no company context)
  // These were bulk-imported gmail/yahoo addresses from candidate screening
  const freeDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];
  return freeDomains.includes(domain);
}

module.exports = { syncHubSpotToNotion };
