import urllib.request
import json

API_KEY = "96e126ff-c740-4e05-a2f3-cb2174c60f03_e8e7snw"
SERVER_URL = "https://interested-list.onrender.com"
CAMPAIGN_IDS = [3454656, 3448126, 3436576]

def api_get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())

def post_to_notion(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{SERVER_URL}/webhooks/smartlead",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Step 1: Get campaign names
campaigns = api_get(f"https://server.smartlead.ai/api/v1/campaigns?api_key={API_KEY}&limit=100")
campaign_map = {c['id']: c['name'] for c in campaigns}
print("SM Campaigns:", {k: v for k, v in campaign_map.items() if k in CAMPAIGN_IDS})

# Step 2: Check one lead to see available fields
print("\n--- Sample lead fields ---")
sample = api_get(f"https://server.smartlead.ai/api/v1/campaigns/{CAMPAIGN_IDS[0]}/leads?api_key={API_KEY}&limit=1&offset=0")
leads = sample if isinstance(sample, list) else sample.get('data', [])
if leads:
    print(json.dumps(leads[0], indent=2))

# Step 3: Pull all replied leads and push to Notion
print("\n--- Pushing replied leads to Notion ---")
total = 0

for cid in CAMPAIGN_IDS:
    campaign_name = campaign_map.get(cid, str(cid))
    offset = 0

    while True:
        url = f"https://server.smartlead.ai/api/v1/campaigns/{cid}/leads?api_key={API_KEY}&limit=100&offset={offset}"
        data = api_get(url)
        leads = data if isinstance(data, list) else data.get('data', [])

        if not leads:
            break

        for lead in leads:
            # Print all status fields to understand the data
            status = (
                lead.get('lead_campaign_status') or
                lead.get('status') or
                lead.get('campaign_status') or
                ''
            )

            # Check if replied — we'll print all statuses first to verify
            print(f"  {lead.get('email')} → status: '{status}' | all keys: {[k for k in lead.keys()]}")

            if 'repl' in str(status).lower():
                payload = {
                    "event": "EMAIL_REPLY",
                    "lead_email": lead.get('email', ''),
                    "lead_name": f"{lead.get('first_name', '')} {lead.get('last_name', '')}".strip(),
                    "campaign_name": campaign_name,
                    "reply_text": ""
                }
                try:
                    result = post_to_notion(payload)
                    print(f"    ✓ Pushed to Notion: {result.get('action')}")
                    total += 1
                except Exception as e:
                    print(f"    ✗ Error: {e}")

        if len(leads) < 100:
            break
        offset += 100

print(f"\nDone. {total} replied leads pushed to Notion.")
