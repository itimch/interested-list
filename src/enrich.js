const axios = require('axios');
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

/**
 * Look up a person via Apollo.io's people/match endpoint.
 * Returns null if the API key is missing or the lookup fails.
 */
async function enrichLead({ email, firstName, lastName, company }) {
  if (!process.env.APOLLO_API_KEY) {
    console.log('[enrich] APOLLO_API_KEY not set — skipping enrichment');
    return null;
  }

  try {
    const { data } = await axios.post(
      'https://api.apollo.io/v1/people/match',
      {
        api_key: process.env.APOLLO_API_KEY,
        email,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        organization_name: company || undefined,
        reveal_personal_emails: false,
      },
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' } }
    );

    const p = data.person;
    if (!p) return null;

    return {
      title: p.title || null,
      linkedinUrl: p.linkedin_url || null,
      companyName: p.organization?.name || company || null,
      companyDomain: p.organization?.website_url || null,
      employeeCount: p.organization?.estimated_num_employees || null,
      industry: p.organization?.industry || null,
      city: p.city || null,
      state: p.state || null,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('[enrich] Apollo error:', msg);
    return null;
  }
}

/**
 * Write enrichment data back to an existing Notion lead page.
 * Only writes fields that are non-null and that the page has.
 */
async function writeEnrichmentToNotion(pageId, enrichment) {
  if (!enrichment) return;

  const properties = {};

  if (enrichment.companyName) {
    properties.Company = { rich_text: [{ text: { content: enrichment.companyName.slice(0, 200) } }] };
  }

  // Build a concise AI Summary from enrichment fields
  const summaryParts = [];
  if (enrichment.title) summaryParts.push(`Title: ${enrichment.title}`);
  if (enrichment.companyName) summaryParts.push(`Company: ${enrichment.companyName}`);
  if (enrichment.industry) summaryParts.push(`Industry: ${enrichment.industry}`);
  if (enrichment.employeeCount) summaryParts.push(`Employees: ~${enrichment.employeeCount}`);
  if (enrichment.city || enrichment.state) {
    summaryParts.push(`Location: ${[enrichment.city, enrichment.state].filter(Boolean).join(', ')}`);
  }
  if (enrichment.companyDomain) summaryParts.push(`Website: ${enrichment.companyDomain}`);
  if (enrichment.linkedinUrl) summaryParts.push(`LinkedIn: ${enrichment.linkedinUrl}`);

  if (summaryParts.length > 0) {
    properties['AI Summary'] = { rich_text: [{ text: { content: summaryParts.join('\n').slice(0, 2000) } }] };
  }

  // Attempt optional dedicated properties — ignore errors if they don't exist
  const optionalUpdates = [];

  if (enrichment.title) {
    optionalUpdates.push(
      notion.pages.update({
        page_id: pageId,
        properties: { Title: { rich_text: [{ text: { content: enrichment.title.slice(0, 200) } }] } },
      }).catch(() => {})
    );
  }

  if (enrichment.linkedinUrl) {
    optionalUpdates.push(
      notion.pages.update({
        page_id: pageId,
        properties: { LinkedIn: { url: enrichment.linkedinUrl } },
      }).catch(() => {})
    );
  }

  await Promise.all([
    Object.keys(properties).length > 0
      ? notion.pages.update({ page_id: pageId, properties })
      : Promise.resolve(),
    ...optionalUpdates,
  ]);

  console.log(`[enrich] Wrote enrichment to Notion page ${pageId}`);
}

module.exports = { enrichLead, writeEnrichmentToNotion };
