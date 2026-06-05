const axios = require('axios');

const hs = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
});

const CONTACT_PROPS = [
  'firstname', 'lastname', 'email', 'company',
  'lifecyclestage', 'hs_lead_status',
  'notes_last_contacted', 'notes_next_activity_date',
].join(',');

async function getRecentlyContactedLeads(limit = 100) {
  const res = await hs.post('/crm/v3/objects/contacts/search', {
    filterGroups: [{
      filters: [{ propertyName: 'notes_last_contacted', operator: 'HAS_PROPERTY' }],
    }],
    sorts: [{ propertyName: 'notes_last_contacted', direction: 'DESCENDING' }],
    properties: CONTACT_PROPS.split(','),
    limit,
  });
  return res.data.results;
}

async function getContact(id) {
  const res = await hs.get(`/crm/v3/objects/contacts/${id}?properties=${CONTACT_PROPS}`);
  return res.data;
}

async function updateContact(id, properties) {
  await hs.patch(`/crm/v3/objects/contacts/${id}`, { properties });
}

function mapLifecycleToStatus(contact) {
  const stage = contact.lifecyclestage;
  const leadStatus = contact.hs_lead_status;

  if (stage === 'customer') return 'Won';
  if (stage === 'opportunity' || stage === 'salesqualifiedlead') return 'Interested';
  if (leadStatus === 'OPEN_DEAL') return 'Meeting Booked';
  if (leadStatus === 'BAD_TIMING') return 'Cold';
  if (['IN_PROGRESS', 'CONNECTED', 'NEW'].includes(leadStatus)) return 'Replied';
  return 'Cold';
}

module.exports = { getRecentlyContactedLeads, getContact, updateContact, mapLifecycleToStatus };
