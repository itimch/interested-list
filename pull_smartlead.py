import urllib.request
import json

API_KEY = "96e126ff-c740-4e05-a2f3-cb2174c60f03_e8e7snw"
SERVER_URL = "https://interested-list.onrender.com"

# Get all campaigns
url = f"https://server.smartlead.ai/api/v1/campaigns?api_key={API_KEY}&limit=100&offset=0"
with urllib.request.urlopen(url) as r:
    campaigns = json.loads(r.read())

sm_campaigns = [c for c in campaigns if c.get('name', '').startswith('SM')]
print(f"Found {len(sm_campaigns)} SM campaigns:")
for c in sm_campaigns:
    print(f"  - {c['name']} (id: {c['id']})")

# Pull replied leads from each campaign
total = 0
for campaign in sm_campaigns:
    cid = campaign['id']
    offset = 0
    while True:
        leads_url = f"https://server.smartlead.ai/api/v1/campaigns/{cid}/leads?api_key={API_KEY}&limit=100&offset={offset}"
        with urllib.request.urlopen(leads_url) as r:
            data = json.loads(r.read())

        leads = data if isinstance(data, list) else data.get('data', [])
        if not leads:
            break

        for lead in leads:
            # Only process replied leads
            if lead.get('lead_campaign_status') not in ('REPLIED', 'EMAIL_REPLIED'):
                continue

            payload = json.dumps({
                "event": "EMAIL_REPLY",
                "lead_email": lead.get('email', ''),
                "lead_name": f"{lead.get('first_name','')} {lead.get('last_name','')}".strip(),
                "campaign_name": campaign['name'],
                "reply_text": ""
            }).encode()

            req = urllib.request.Request(
                f"{SERVER_URL}/webhooks/smartlead",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            try:
                with urllib.request.urlopen(req) as res:
                    result = json.loads(res.read())
                    print(f"  ✓ {lead.get('email')} — {result.get('action', 'ok')}")
                    total += 1
            except Exception as e:
                print(f"  ✗ {lead.get('email')} — {e}")

        if len(leads) < 100:
            break
        offset += 100

print(f"\nDone. {total} replied leads pushed to Notion.")
