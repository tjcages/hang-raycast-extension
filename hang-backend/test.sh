#!/bin/bash

BACKEND_URL="http://localhost:8787"
STATE=$(openssl rand -hex 16)

echo "🧪 Testing Hang Backend"
echo "========================"
echo ""
echo "1️⃣  Opening OAuth flow..."
echo "   State: $STATE"
echo "   URL: $BACKEND_URL/oauth/start?state=$STATE"
echo ""
open "$BACKEND_URL/oauth/start?state=$STATE"

echo "2️⃣  After authorizing in your browser, press Enter to retrieve token..."
read

echo ""
echo "3️⃣  Retrieving token..."
TOKEN_RESPONSE=$(curl -s "$BACKEND_URL/oauth/token?state=$STATE")
TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "   ❌ Error: Token not found"
  echo "   Response: $TOKEN_RESPONSE"
  exit 1
fi

echo "   ✅ Token retrieved: ${TOKEN:0:20}..."
echo ""

echo "4️⃣  Creating meeting..."
MEETING_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/create-meeting" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

MEET_LINK=$(echo $MEETING_RESPONSE | grep -o '"meetLink":"[^"]*' | cut -d'"' -f4)

if [ -n "$MEET_LINK" ]; then
  echo "   ✅ Meeting created!"
  echo "   Link: $MEET_LINK"
else
  echo "   ❌ Error creating meeting"
  echo "   Response: $MEETING_RESPONSE"
fi



