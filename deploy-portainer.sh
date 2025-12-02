#!/bin/bash
# Portainer deployment script for iRadio
# Usage: ./deploy-portainer.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== iRadio Portainer Deployment ===${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    echo "Creating .env.example template..."
    echo "Please create .env file with your configuration"
    exit 1
fi

# Load environment variables
source .env

# Validate required variables
if [ -z "$PORTAINER_URL" ]; then
    echo -e "${RED}Error: PORTAINER_URL not set in .env${NC}"
    exit 1
fi

if [ -z "$PORTAINER_TOKEN" ]; then
    echo -e "${RED}Error: PORTAINER_TOKEN not set in .env${NC}"
    exit 1
fi

if [ -z "$GOOGLE_AI_API_KEY" ]; then
    echo -e "${YELLOW}Warning: GOOGLE_AI_API_KEY not set${NC}"
fi

if [ -z "$ASSEMBLYAI_API_KEY" ]; then
    echo -e "${YELLOW}Warning: ASSEMBLYAI_API_KEY not set${NC}"
fi

# Default values
ENDPOINT_ID=${ENDPOINT_ID:-1}
STACK_NAME=${STACK_NAME:-iradio}
REPO_URL=${REPO_URL:-"https://github.com/your-username/your-repo.git"}
REPO_BRANCH=${REPO_BRANCH:-main}

echo -e "${GREEN}Configuration:${NC}"
echo "  Portainer URL: $PORTAINER_URL"
echo "  Stack Name: $STACK_NAME"
echo "  Repository: $REPO_URL"
echo "  Branch: $REPO_BRANCH"
echo ""

# Check if stack already exists
echo "Checking for existing stack..."
EXISTING_STACK=$(curl -s \
  "${PORTAINER_URL}/api/stacks" \
  -H "X-API-Key: ${PORTAINER_TOKEN}" \
  | jq -r ".[] | select(.Name==\"${STACK_NAME}\") | .Id" || echo "")

if [ ! -z "$EXISTING_STACK" ]; then
    echo -e "${YELLOW}Stack '${STACK_NAME}' already exists (ID: ${EXISTING_STACK})${NC}"
    read -p "Update existing stack? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Updating stack..."
        curl -X PUT \
          "${PORTAINER_URL}/api/stacks/${EXISTING_STACK}?endpointId=${ENDPOINT_ID}" \
          -H "X-API-Key: ${PORTAINER_TOKEN}" \
          -H "Content-Type: application/json" \
          -d "{
            \"RepositoryURL\": \"${REPO_URL}\",
            \"RepositoryReferenceName\": \"${REPO_BRANCH}\",
            \"ComposeFile\": \"docker-compose.yml\",
            \"Env\": [
              {\"name\": \"GOOGLE_AI_API_KEY\", \"value\": \"${GOOGLE_AI_API_KEY}\"},
              {\"name\": \"ASSEMBLYAI_API_KEY\", \"value\": \"${ASSEMBLYAI_API_KEY}\"},
              {\"name\": \"MURF_API_KEY\", \"value\": \"${MURF_API_KEY}\"},
              {\"name\": \"NODE_ENV\", \"value\": \"production\"},
              {\"name\": \"PORT\", \"value\": \"3001\"},
              {\"name\": \"HOST\", \"value\": \"0.0.0.0\"},
              {\"name\": \"WAKE_WORD_PORT\", \"value\": \"8000\"}
            ]
          }"
        echo -e "\n${GREEN}Stack updated successfully!${NC}"
    else
        echo "Deployment cancelled"
        exit 0
    fi
else
    echo "Creating new stack..."
    curl -X POST \
      "${PORTAINER_URL}/api/stacks?endpointId=${ENDPOINT_ID}&method=repository" \
      -H "X-API-Key: ${PORTAINER_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{
        \"Name\": \"${STACK_NAME}\",
        \"RepositoryURL\": \"${REPO_URL}\",
        \"RepositoryReferenceName\": \"${REPO_BRANCH}\",
        \"ComposeFile\": \"docker-compose.yml\",
        \"Env\": [
          {\"name\": \"GOOGLE_AI_API_KEY\", \"value\": \"${GOOGLE_AI_API_KEY}\"},
          {\"name\": \"ASSEMBLYAI_API_KEY\", \"value\": \"${ASSEMBLYAI_API_KEY}\"},
          {\"name\": \"MURF_API_KEY\", \"value\": \"${MURF_API_KEY}\"},
          {\"name\": \"NODE_ENV\", \"value\": \"production\"},
          {\"name\": \"PORT\", \"value\": \"3001\"},
          {\"name\": \"HOST\", \"value\": \"0.0.0.0\"},
          {\"name\": \"WAKE_WORD_PORT\", \"value\": \"8000\"}
        ]
      }"
    echo -e "\n${GREEN}Stack created successfully!${NC}"
fi

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Check stack status in Portainer UI"
echo "2. Verify containers are running"
echo "3. Test endpoints:"
echo "   - API: curl http://your-server:3001/api/health"
echo "   - Wake Word: curl http://your-server:8000/health"

