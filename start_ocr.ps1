# Starts the OCR app in the background (if not already running) and opens it in the browser.
$ErrorActionPreference = "Stop"
$dir = $PSScriptRoot
$url = "http://127.0.0.1:5000"

function Test-Server {
    try { (Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

if (-not (Test-Server)) {
    Start-Process -FilePath "python" -ArgumentList "app.py" -WorkingDirectory $dir `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $dir "app.log") `
        -RedirectStandardError (Join-Path $dir "app.err.log")

    # Loading the OCR models takes a few seconds
    $deadline = (Get-Date).AddSeconds(120)
    while (-not (Test-Server)) {
        if ((Get-Date) -gt $deadline) {
            Add-Type -AssemblyName PresentationFramework
            [System.Windows.MessageBox]::Show("The OCR app did not start. See app.err.log in $dir", "OCR") | Out-Null
            exit 1
        }
        Start-Sleep -Seconds 2
    }
}

Start-Process $url
