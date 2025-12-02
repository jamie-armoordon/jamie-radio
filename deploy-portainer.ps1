# Portainer Deployment Script for iRadio
# Deploys the stack to Portainer using the API

$ErrorActionPreference = "Stop"
$VerbosePreference = "Continue"

# Configuration
$PORTAINER_URL = "https://server.jamiearmoordon.co.uk/portainer"
$PORTAINER_TOKEN = "ptr_ggewXm6IvyuUgtKI8LbBQ9UFVeVtAJp3hTYqCDJiQX8="
$REPO_URL = "https://github.com/jamie-armoordon/jamie-radio.git"
$STACK_NAME = "iradio"
$ENDPOINT_ID = 1

# Load environment variables from .env
Write-Verbose "Loading environment variables from .env file..." -Verbose
if (Test-Path .env) {
    Write-Verbose ".env file found, loading variables..." -Verbose
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Variable -Name $key -Value $value -Scope Script
            Write-Verbose "  Loaded: $key = $($value.Substring(0,[Math]::Min(10,$value.Length)))..." -Verbose
        }
    }
} else {
    Write-Verbose ".env file not found, using script defaults" -Verbose
}

Write-Host "=== iRadio Portainer Deployment ===" -ForegroundColor Green
Write-Verbose "Configuration:" -Verbose
Write-Verbose "  Portainer URL: $PORTAINER_URL" -Verbose
Write-Verbose "  Portainer Token: $($PORTAINER_TOKEN.Substring(0,20))..." -Verbose
Write-Verbose "  Stack Name: $STACK_NAME" -Verbose
Write-Verbose "  Repository: $REPO_URL" -Verbose
Write-Verbose "  Endpoint ID: $ENDPOINT_ID" -Verbose
Write-Host "Portainer URL: $PORTAINER_URL"
Write-Host "Stack Name: $STACK_NAME"
Write-Host "Repository: $REPO_URL"
Write-Host ""

# Prepare environment variables array
Write-Verbose "Preparing environment variables..." -Verbose
$envVars = @(
    @{ name = "NODE_ENV"; value = "production" },
    @{ name = "PORT"; value = "3001" },
    @{ name = "HOST"; value = "0.0.0.0" },
    @{ name = "WAKE_WORD_PORT"; value = "8000" }
)
Write-Verbose "  Base variables: NODE_ENV, PORT, HOST, WAKE_WORD_PORT" -Verbose

# Add API keys if they exist
if ($ASSEMBLYAI_API_KEY) {
    $envVars += @{ name = "ASSEMBLYAI_API_KEY"; value = $ASSEMBLYAI_API_KEY }
    Write-Verbose "  Added: ASSEMBLYAI_API_KEY" -Verbose
} else {
    Write-Verbose "  Warning: ASSEMBLYAI_API_KEY not found" -Verbose
}
if ($MURF_API_KEY) {
    $envVars += @{ name = "MURF_API_KEY"; value = $MURF_API_KEY }
    Write-Verbose "  Added: MURF_API_KEY" -Verbose
} else {
    Write-Verbose "  Warning: MURF_API_KEY not found" -Verbose
}
if ($GOOGLE_AI_API_KEY) {
    $envVars += @{ name = "GOOGLE_AI_API_KEY"; value = $GOOGLE_AI_API_KEY }
    Write-Verbose "  Added: GOOGLE_AI_API_KEY" -Verbose
} else {
    Write-Verbose "  Warning: GOOGLE_AI_API_KEY not found" -Verbose
}
if ($CAMB_AI_API_KEY) {
    $envVars += @{ name = "CAMB_AI_API_KEY"; value = $CAMB_AI_API_KEY }
    Write-Verbose "  Added: CAMB_AI_API_KEY" -Verbose
}
Write-Verbose "Total environment variables: $($envVars.Count)" -Verbose

# Check if stack already exists
Write-Host "Checking for existing stack..." -ForegroundColor Yellow
Write-Verbose "Setting up API headers..." -Verbose
$headers = @{
    "X-API-Key" = $PORTAINER_TOKEN
    "Content-Type" = "application/json"
}
Write-Verbose "API endpoint: $PORTAINER_URL/api/stacks" -Verbose

try {
    Write-Verbose "Sending GET request to check existing stacks..." -Verbose
    $stacksResponse = Invoke-RestMethod -Uri "$PORTAINER_URL/api/stacks" -Method Get -Headers $headers -TimeoutSec 30 -ErrorAction Stop
    Write-Verbose "Found $($stacksResponse.Count) existing stack(s)" -Verbose
    $existingStack = $stacksResponse | Where-Object { $_.Name -eq $STACK_NAME } | Select-Object -First 1
    if ($existingStack) {
        Write-Verbose "Existing stack found: ID=$($existingStack.Id), Name=$($existingStack.Name)" -Verbose
    } else {
        Write-Verbose "No existing stack named '$STACK_NAME' found" -Verbose
    }
} catch {
    Write-Host "Could not check existing stacks, proceeding with creation..." -ForegroundColor Yellow
    Write-Verbose "Error checking stacks: $_" -Verbose
    Write-Verbose "Exception: $($_.Exception.Message)" -Verbose
    $existingStack = $null
}

if ($existingStack) {
    Write-Host "Stack '$STACK_NAME' already exists (ID: $($existingStack.Id))" -ForegroundColor Yellow
    Write-Verbose "Prompting user for update confirmation..." -Verbose
    $update = Read-Host "Update existing stack? (y/n)"
    Write-Verbose "User response: $update" -Verbose
    if ($update -eq "y" -or $update -eq "Y") {
        Write-Host "Updating stack..." -ForegroundColor Yellow
        Write-Verbose "Preparing update request body..." -Verbose
        
        $updateBody = @{
            RepositoryURL = $REPO_URL
            RepositoryReferenceName = "main"
            ComposeFile = "docker-compose.yml"
            Env = $envVars
        }
        $updateBodyJson = $updateBody | ConvertTo-Json -Depth 10
        Write-Verbose "Update body prepared (length: $($updateBodyJson.Length) chars)" -Verbose
        Write-Verbose "Update endpoint: $PORTAINER_URL/api/stacks/$($existingStack.Id)?endpointId=$ENDPOINT_ID" -Verbose
        
        try {
            Write-Verbose "Sending PUT request to update stack..." -Verbose
            $response = Invoke-RestMethod -Uri "$PORTAINER_URL/api/stacks/$($existingStack.Id)?endpointId=$ENDPOINT_ID" `
                -Method Put -Headers $headers -Body $updateBodyJson -ContentType "application/json" -TimeoutSec 60 -ErrorAction Stop
            Write-Verbose "Update response received successfully" -Verbose
            Write-Host "Stack updated successfully!" -ForegroundColor Green
            Write-Host "Stack ID: $($response.Id)" -ForegroundColor Green
            Write-Verbose "Response details: $($response | ConvertTo-Json -Depth 3)" -Verbose
        } catch {
            Write-Host "Error updating stack: $_" -ForegroundColor Red
            Write-Verbose "Exception type: $($_.Exception.GetType().FullName)" -Verbose
            Write-Verbose "Exception message: $($_.Exception.Message)" -Verbose
            if ($_.Exception.Response) {
                Write-Verbose "HTTP Status: $($_.Exception.Response.StatusCode.value__)" -Verbose
                Write-Verbose "Status Description: $($_.Exception.Response.StatusDescription)" -Verbose
                try {
                    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $responseBody = $reader.ReadToEnd()
                    Write-Host "Response body: $responseBody" -ForegroundColor Red
                    Write-Verbose "Full response: $responseBody" -Verbose
                } catch {
                    Write-Verbose "Could not read response stream: $_" -Verbose
                }
            }
            exit 1
        }
    } else {
        Write-Host "Deployment cancelled" -ForegroundColor Yellow
        exit 0
    }
} else {
    Write-Host "Creating new stack..." -ForegroundColor Yellow
    Write-Verbose "Reading docker-compose.yml file..." -Verbose
    
    if (-not (Test-Path "docker-compose.yml")) {
        Write-Host "Error: docker-compose.yml not found!" -ForegroundColor Red
        exit 1
    }
    
    $composeContent = Get-Content "docker-compose.yml" -Raw
    Write-Verbose "docker-compose.yml loaded (length: $($composeContent.Length) chars)" -Verbose
    
    Write-Verbose "Preparing create request body (using string method)..." -Verbose
    
    $createBody = @{
        Name = $STACK_NAME
        StackFileContent = $composeContent
        Env = $envVars
    }
    $createBodyJson = $createBody | ConvertTo-Json -Depth 10
    Write-Verbose "Create body prepared (length: $($createBodyJson.Length) chars)" -Verbose
    Write-Verbose "Create endpoint: $PORTAINER_URL/api/stacks?endpointId=$ENDPOINT_ID&method=string" -Verbose
    Write-Verbose "Request body preview: $($createBodyJson.Substring(0,[Math]::Min(500,$createBodyJson.Length)))..." -Verbose
    
    try {
        Write-Verbose "Sending POST request to create stack..." -Verbose
        Write-Verbose "Request timeout set to 60 seconds..." -Verbose
        $response = Invoke-RestMethod -Uri "$PORTAINER_URL/api/stacks?endpointId=$ENDPOINT_ID&method=string" `
            -Method Post -Headers $headers -Body $createBodyJson -ContentType "application/json" -TimeoutSec 60 -ErrorAction Stop
        Write-Verbose "Create response received successfully" -Verbose
        Write-Host "Stack created successfully!" -ForegroundColor Green
        Write-Host "Stack ID: $($response.Id)" -ForegroundColor Green
        Write-Verbose "Response details: $($response | ConvertTo-Json -Depth 3)" -Verbose
    } catch {
        Write-Host "Error creating stack: $_" -ForegroundColor Red
        Write-Verbose "Exception type: $($_.Exception.GetType().FullName)" -Verbose
        Write-Verbose "Exception message: $($_.Exception.Message)" -Verbose
        Write-Verbose "Exception stack trace: $($_.Exception.StackTrace)" -Verbose
        if ($_.Exception.Response) {
            Write-Verbose "HTTP Status: $($_.Exception.Response.StatusCode.value__)" -Verbose
            Write-Verbose "Status Description: $($_.Exception.Response.StatusDescription)" -Verbose
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $responseBody = $reader.ReadToEnd()
                Write-Host "Response body: $responseBody" -ForegroundColor Red
                Write-Verbose "Full error response: $responseBody" -Verbose
            } catch {
                Write-Verbose "Could not read response stream: $_" -Verbose
            }
        }
        Write-Verbose "Request that failed:" -Verbose
        Write-Verbose "  URL: $PORTAINER_URL/api/stacks?endpointId=$ENDPOINT_ID&method=string" -Verbose
        Write-Verbose "  Method: POST" -Verbose
        Write-Verbose "  Body length: $($createBodyJson.Length)" -Verbose
        exit 1
    }
}

Write-Host ""
Write-Verbose "Deployment process completed" -Verbose
Write-Host "Deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Check stack status in Portainer: $PORTAINER_URL"
Write-Host "2. Verify containers are running"
Write-Host "3. Test endpoints:"
Write-Host "   - API: curl http://server.jamiearmoordon.co.uk:3001/api/health"
Write-Host "   - Wake Word: curl http://server.jamiearmoordon.co.uk:8000/health"
Write-Verbose "Script execution finished" -Verbose

