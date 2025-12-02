# Portainer API Deployment Guide

This guide shows how to deploy iRadio using Portainer's API with an access token.

## Using Portainer Access Token

### Option 1: Portainer Web UI

1. **Login to Portainer**
   - Navigate to your Portainer instance
   - Use the access token when prompted, or set it as an environment variable

2. **Deploy Stack via UI**
   - Go to **Stacks** → **Add Stack**
   - Use the token for authentication if required

### Option 2: Portainer API (cURL)

Deploy using Portainer's REST API:

```bash
# Set your Portainer URL and token
PORTAINER_URL="http://your-portainer-host:9000"
PORTAINER_TOKEN="ptr_ggewXm6IvyuUgtKI8LbBQ9UFVeVtAJp3hTYqCDJiQX8="

# Get endpoint ID (usually 1 for local)
ENDPOINT_ID=1

# Create stack via API
curl -X POST \
  "${PORTAINER_URL}/api/stacks?endpointId=${ENDPOINT_ID}&method=repository" \
  -H "X-API-Key: ${PORTAINER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "iradio",
    "RepositoryURL": "https://github.com/your-username/your-repo.git",
    "RepositoryReferenceName": "main",
    "ComposeFile": "docker-compose.yml",
    "Env": [
      {
        "name": "GOOGLE_AI_API_KEY",
        "value": "your_key_here"
      },
      {
        "name": "ASSEMBLYAI_API_KEY",
        "value": "your_key_here"
      },
      {
        "name": "MURF_API_KEY",
        "value": "your_key_here"
      }
    ]
  }'
```

### Option 3: Portainer CLI

If you have Portainer CLI installed:

```bash
export PORTAINER_TOKEN="ptr_ggewXm6IvyuUgtKI8LbBQ9UFVeVtAJp3hTYqCDJiQX8="
export PORTAINER_URL="http://your-portainer-host:9000"

portainer stack deploy \
  --name iradio \
  --repository https://github.com/your-username/your-repo.git \
  --branch main \
  --compose-file docker-compose.yml \
  --env GOOGLE_AI_API_KEY=your_key \
  --env ASSEMBLYAI_API_KEY=your_key \
  --env MURF_API_KEY=your_key
```

## Security Best Practices

⚠️ **IMPORTANT**: 

1. **Never commit tokens to Git**
   - Add `.env` and token files to `.gitignore`
   - Use environment variables or secrets management

2. **Rotate tokens regularly**
   - Generate new tokens periodically
   - Revoke old tokens when no longer needed

3. **Use token scopes**
   - Create tokens with minimal required permissions
   - Don't use admin tokens for deployments

4. **Store tokens securely**
   - Use environment variables: `export PORTAINER_TOKEN="..."`
   - Use secrets management (Docker secrets, Kubernetes secrets, etc.)
   - Never hardcode in scripts or documentation

## Environment Variables Setup

Create a `.env` file (DO NOT commit to Git):

```env
# Portainer Configuration
PORTAINER_URL=http://your-portainer-host:9000
PORTAINER_TOKEN=ptr_ggewXm6IvyuUgtKI8LbBQ9UFVeVtAJp3hTYqCDJiQX8=

# Application API Keys
GOOGLE_AI_API_KEY=your_google_ai_api_key
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
MURF_API_KEY=your_murf_api_key
```

Then source it:
```bash
source .env
```

## Deployment Script Example

Create `deploy.sh`:

```bash
#!/bin/bash
set -e

# Load environment variables
source .env

# Validate token is set
if [ -z "$PORTAINER_TOKEN" ]; then
    echo "Error: PORTAINER_TOKEN not set"
    exit 1
fi

# Deploy stack
curl -X POST \
  "${PORTAINER_URL}/api/stacks?endpointId=1&method=repository" \
  -H "X-API-Key: ${PORTAINER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "Name": "iradio",
  "RepositoryURL": "${REPO_URL}",
  "RepositoryReferenceName": "main",
  "ComposeFile": "docker-compose.yml",
  "Env": [
    {"name": "GOOGLE_AI_API_KEY", "value": "${GOOGLE_AI_API_KEY}"},
    {"name": "ASSEMBLYAI_API_KEY", "value": "${ASSEMBLYAI_API_KEY}"},
    {"name": "MURF_API_KEY", "value": "${MURF_API_KEY}"}
  ]
}
EOF

echo "Deployment initiated!"
```

Make it executable:
```bash
chmod +x deploy.sh
```

## Verifying Deployment

Check stack status:

```bash
curl -X GET \
  "${PORTAINER_URL}/api/stacks" \
  -H "X-API-Key: ${PORTAINER_TOKEN}" \
  | jq '.[] | select(.Name=="iradio")'
```

Check container logs:

```bash
# Get container ID
CONTAINER_ID=$(curl -s \
  "${PORTAINER_URL}/api/endpoints/1/docker/containers/json" \
  -H "X-API-Key: ${PORTAINER_TOKEN}" \
  | jq -r '.[] | select(.Names[] | contains("iradio-api")) | .Id')

# Get logs
curl -s \
  "${PORTAINER_URL}/api/endpoints/1/docker/containers/${CONTAINER_ID}/logs?stdout=1&stderr=1" \
  -H "X-API-Key: ${PORTAINER_TOKEN}"
```

## Troubleshooting

### Token Authentication Failed

- Verify token is correct and not expired
- Check token has required permissions
- Ensure Portainer URL is accessible

### Stack Creation Failed

- Verify Git repository is accessible
- Check `docker-compose.yml` syntax
- Review Portainer logs for errors

### Containers Not Starting

- Check environment variables are set correctly
- Verify ports are not already in use
- Review container logs in Portainer UI

## Next Steps

1. **Set up your API keys** in environment variables
2. **Deploy the stack** using one of the methods above
3. **Verify deployment** by checking container status
4. **Configure reverse proxy** if needed (see DOCKER_DEPLOYMENT.md)
5. **Set up monitoring** and alerts in Portainer

For more details, see:
- [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) - Full deployment guide
- [PORTAINER_QUICK_START.md](./PORTAINER_QUICK_START.md) - Quick reference

