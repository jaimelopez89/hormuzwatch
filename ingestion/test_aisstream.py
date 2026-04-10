"""Quick connectivity test — run this to verify your AISStream API key works."""
import asyncio
import json
import sys
import websockets

API_KEY = "79bdbc48d8f53e47d7d821aab860bd12fb97de92"
URL = "wss://stream.aisstream.io/v0/stream"

SUBSCRIBE = {
    "APIKey": API_KEY,
    "BoundingBoxes": [[[22.0, 54.0], [28.0, 62.0]]],
    "FilterMessageTypes": ["PositionReport"],
}


async def test():
    print(f"Connecting to {URL} …")
    try:
        async with websockets.connect(URL) as ws:
            print("Connected. Sending subscribe…")
            await ws.send(json.dumps(SUBSCRIBE))
            print("Waiting for first message (up to 30s)…")
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=30)
                data = json.loads(msg)
                mmsi = data.get("MetaData", {}).get("MMSI", "?")
                name = data.get("MetaData", {}).get("ShipName", "?").strip()
                print(f"\n✓ SUCCESS — received message!")
                print(f"  First vessel: MMSI={mmsi} name={name}")
                print(f"  API key is valid and working.\n")
            except asyncio.TimeoutError:
                print("\n⚠ No message received in 30s — key accepted but no vessels in bbox right now.")
                print("  Try again in a few minutes, or the Hormuz region may have low traffic.\n")
    except websockets.exceptions.InvalidStatusCode as e:
        print(f"\n✗ Connection rejected: HTTP {e.status_code}")
        print("  → API key is likely invalid or expired. Check aisstream.io\n")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Connection failed: {e}\n")
        sys.exit(1)


asyncio.run(test())
