const axios = require('axios');
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

/**
 * Enrich a lead using Claude (claude-haiku-4-5) via the Anthropic API.
 * Extracts company context from the email domain and any available name/company info,
 * then asks Claude to return structured JSON with what it knows.
 */
async function enrichLead({ email, firstName, lastName, company }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[enrich] ANTHROPIC_API_KEY not set — skipping enrichment');
    return null;
  }

  const domain = email.split('@')[1] || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  const prompt = `You are a B2B sales researcher. Given the following contact info, return a JSON object with what you know about this person and their company. If you're unsure about something, omit that field rather than guessing.

Contact:
- Name: ${fullName || 'Unknown'}
- Email: ${email}
- Email domain: ${domain}
- Company (if known): ${company || 'Unknown'}

Return ONLY valid JSON with these fields (omit any you don't know):
{
  "title": "their likely job title",
  "companyName": "full company name",
  "companyDescription": "1-2 sentence description of what the company does",
  "industry": "industry category",
  "companySize": "rough employee count or size (e.g. 50-200, startup, enterprise)",
  "website": "company website URL",
  "linkedinCompanyUrl": "company LinkedIn URL if you know it",
  "notes": "any other relevant context about this person or company for a sales rep"
}`;

  try {
    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[enrich] Claude returned no JSON:', text.slice(0, 200));
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[enrich] Anthropic error:', msg);
    return null;
  }
}

/**
 * Write enrichment data back to an existing Notion lead page.
 */
async function writeEnrichmentToNotion(pageId, enrichment) {
  if (!enrichment) return;

  const summaryParts = [];
  if (enrichment.title) summaryParts.push(`Title: ${enrichment.title}`);
  if (enrichment.companyName) summaryParts.push(`Company: ${enrichment.companyName}`);
  if (enrichment.companyDescription) summaryParts.push(`About: ${enrichment.companyDescription}`);
  if (enrichment.industry) summaryParts.push(`Industry: ${enrichment.industry}`);
  if (enrichment.companySize) summaryParts.push(`Size: ${enrichment.companySize}`);
  if (enrichment.website) summaryParts.push(`Website: ${enrichment.website}`);
  if (enrichment.linkedinCompanyUrl) summaryParts.push(`LinkedIn: ${enrichment.linkedinCompanyUrl}`);
  if (enrichment.notes) summaryParts.push(`Notes: ${enrichment.notes}`);

  if (summaryParts.length === 0) return;

  const properties = {
    'AI Summary': { rich_text: [{ text: { content: summaryParts.join('\n').slice(0, 2000) } }] },
  };

  if (enrichment.companyName) {
    properties.Company = { rich_text: [{ text: { content: enrichment.companyName.slice(0, 200) } }] };
  }

  await notion.pages.update({ page_id: pageId, properties });

  // Try optional dedicated properties — silently skip if they don't exist in the DB
  const optionals = [];
  if (enrichment.title) {
    optionals.push(
      notion.pages.update({
        page_id: pageId,
        properties: { Title: { rich_text: [{ text: { content: enrichment.title.slice(0, 200) } }] } },
      }).catch(() => {})
    );
  }
  if (enrichment.website) {
    optionals.push(
      notion.pages.update({
        page_id: pageId,
        properties: { Website: { url: enrichment.website } },
      }).catch(() => {})
    );
  }

  await Promise.all(optionals);
  console.log(`[enrich] Wrote enrichment to Notion page ${pageId}`);
}

module.exports = { enrichLead, writeEnrichmentToNotion };
