# Scarica whisper.cpp (Windows, CPU) e un modello in %USERPROFILE%\whisper.
# Uso: install-whisper-windows.bat [small|medium|large-v3-turbo]
param([string]$Model = 'small')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # senza, Invoke-WebRequest è molto lento
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dest = Join-Path $env:USERPROFILE 'whisper'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host 'Cerco l''ultima versione di whisper.cpp...'
$rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest' -Headers @{ 'User-Agent' = 'social-ae' }
$asset = $rel.assets | Where-Object { $_.name -eq 'whisper-bin-x64.zip' } | Select-Object -First 1
if (-not $asset) { throw 'Non trovo whisper-bin-x64.zip nell''ultima release. Scaricalo a mano da github.com/ggml-org/whisper.cpp/releases' }

$zip = Join-Path $dest 'whisper-bin-x64.zip'
Write-Host ("Scarico {0} ({1} MB)..." -f $asset.name, [int]($asset.size / 1MB))
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
$bin = Join-Path $dest 'bin'
if (Test-Path $bin) { Remove-Item $bin -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $bin -Force
Remove-Item $zip

$exe = Get-ChildItem -Path $bin -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
if (-not $exe) { throw 'whisper-cli.exe non trovato nell''archivio.' }

$modelFile = Join-Path $dest ("ggml-{0}.bin" -f $Model)
if (-not (Test-Path $modelFile)) {
    Write-Host ("Scarico il modello {0} (puo richiedere qualche minuto)..." -f $Model)
    Invoke-WebRequest -Uri ("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{0}.bin" -f $Model) -OutFile $modelFile
}

Write-Host ''
Write-Host 'Fatto. Nelle Impostazioni del pannello scegli "whisper.cpp" e incolla:'
Write-Host ''
Write-Host ("Eseguibile: {0}" -f $exe.FullName)
Write-Host ("Modello:    {0}" -f $modelFile)
Write-Host ''
Set-Clipboard -Value $exe.FullName
Write-Host 'Il percorso dell''eseguibile e gia negli appunti.'
