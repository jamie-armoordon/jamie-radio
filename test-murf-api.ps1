# Test script for Murf AI Falcon TTS API
$ErrorActionPreference = "Stop"

# Load .env file
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

$MURF_API_KEY = $env:MURF_API_KEY
# Gen 2 is only available on api.murf.ai (not uk.api.murf.ai)
$ENDPOINT = "https://api.murf.ai/v1/speech/stream"
# Radio voices with styles:
# Theo (en-UK-theo) - Narration style (professional male radio host)
# Gabriel (en-UK-gabriel) - Promo style (energetic male radio DJ)
# Freddie (en-UK-freddie) - Narration style (deep male)
$VOICE_ID = "en-UK-theo"
$STYLE = "Narration"
$TEST_TEXT = "Hello, this is a test of Murf AI Falcon text to speech. This should sound natural and expressive, like a professional radio DJ."

Write-Host "Testing Murf AI Falcon TTS API..." -ForegroundColor Cyan
Write-Host ""

if (-not $MURF_API_KEY) {
    Write-Host "Error: MURF_API_KEY not set" -ForegroundColor Red
    exit 1
}

Write-Host "Endpoint: $ENDPOINT" -ForegroundColor Gray
Write-Host "Voice ID: $VOICE_ID" -ForegroundColor Gray
Write-Host "Style: $STYLE" -ForegroundColor Gray
Write-Host "Variation: 5 (maximum for natural speech)" -ForegroundColor Gray
Write-Host "Rate: 2 (slightly faster)" -ForegroundColor Gray
Write-Host "Pitch: -5 (slightly deeper)" -ForegroundColor Gray
Write-Host ""

try {
    $headers = @{
        "api-key" = $MURF_API_KEY
        "Content-Type" = "application/json"
    }
    
    $body = @{
        text = $TEST_TEXT
        voice_id = $VOICE_ID
        model = "gen2"
        language = "en-UK"
        style = $STYLE
        variation = 5
        rate = 2
        pitch = -5
    } | ConvertTo-Json
    
    $outputPath = Join-Path $PSScriptRoot "test-murf-output.wav"
    $startTime = Get-Date
    
    $response = Invoke-WebRequest -Uri $ENDPOINT -Method Post -Headers $headers -ContentType "application/json" -Body $body -OutFile $outputPath -TimeoutSec 30
    
    $elapsed = ((Get-Date) - $startTime).TotalMilliseconds
    Write-Host "Request completed in $([Math]::Round($elapsed))ms" -ForegroundColor Green
    Write-Host "Status: $($response.StatusCode)" -ForegroundColor Gray
    
    $audioBytes = [System.IO.File]::ReadAllBytes($outputPath)
    Write-Host "Success! Received $($audioBytes.Length) bytes" -ForegroundColor Green
    Write-Host "Audio saved to: $outputPath" -ForegroundColor Green
    
    if ($audioBytes.Length -ge 4) {
        $header = [System.Text.Encoding]::ASCII.GetString($audioBytes[0..3])
        if ($header -eq "RIFF") {
            Write-Host "Audio format: WAV" -ForegroundColor Green
        }
    }
    
    Write-Host "Test completed successfully!" -ForegroundColor Green
    
} catch {
    Write-Host "Test failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "Response: $responseBody" -ForegroundColor Red
        } catch {}
    }
    exit 1
}
