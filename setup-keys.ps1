$ErrorActionPreference = 'Stop'
$configFile = Join-Path $PSScriptRoot '.env'

if (Test-Path -LiteralPath $configFile) {
    Write-Host 'A local .env file already exists. Edit that file to update your keys.'
    return
}

function Read-ProviderKey([string] $Prompt) {
    while ($true) {
        $secret = Read-Host -Prompt $Prompt -AsSecureString
        $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try {
            $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer).Trim()
            if ($key -match '^[A-Za-z0-9._+/:=-]{8,8192}$') {
                return $key
            }
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)
            $secret.Dispose()
        }
        Write-Host 'Enter one API key without quotes or spaces.'
    }
}

Write-Host 'Rollout Trace | Local API setup'
Write-Host 'The keys go into the local .env file, which Git ignores. Input is masked.'
$nebiusKey = Read-ProviderKey 'Nebius Token Factory API key'
$tavilyKey = Read-ProviderKey 'Tavily API key'
$config = "NEBIUS_API_KEY=$nebiusKey`nTAVILY_API_KEY=$tavilyKey`n"
New-Item -ItemType File -Path $configFile -Value $config | Out-Null
Write-Host 'Keys saved. Restart Rollout Trace to enable live investigations.'
