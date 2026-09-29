# Scarica whisper.cpp (Windows, CPU) e un modello in %USERPROFILE%\whisper.
# Uso: install-whisper-windows.bat [small|medium|large-v3-turbo]
param([string]$Model = 'small')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # senza, Invoke-WebRequest e molto lento
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dest = Join-Path $env:USERPROFILE 'whisper'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host 'Cerco l''ultima versione di whisper.cpp con i file per Windows...'
$headers = @{ 'User-Agent' = 'social-ae' }
$releases = Invoke-RestMethod -Uri 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15' -Headers $headers

# I nomi cambiano da una versione all'altra: si accettano piu varianti, escludendo quelle per GPU.
$patterns = @('^whisper-bin-x64\.zip$', '^whisper-.*bin-x64.*\.zip$', 'x64.*\.zip$')
$asset = $null
foreach ($r in $releases) {
    foreach ($pat in $patterns) {
        $asset = $r.assets | Where-Object { $_.name -match $pat -and $_.name -notmatch 'cublas|cuda|blas|vulkan|openvino' } | Select-Object -First 1
        if ($asset) { break }
    }
    if ($asset) { Write-Host ("Versione {0}" -f $r.tag_name); break }
}
if (-not $asset) {
    Write-Host 'File disponibili nelle ultime release:'
    $releases | Select-Object -First 3 | ForEach-Object { Write-Host $_.tag_name; $_.assets | ForEach-Object { Write-Host ('   ' + $_.name) } }
    throw 'Non trovo un archivio whisper.cpp per Windows x64. Copia l''elenco qui sopra e mandalo a Claude.'
}

$zip = Join-Path $dest 'whisper-bin-x64.zip'
Write-Host ("Scarico {0} ({1} MB)..." -f $asset.name, [int]($asset.size / 1MB))
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
$bin = Join-Path $dest 'bin'
if (Test-Path $bin) { Remove-Item $bin -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $bin -Force
Remove-Item $zip

$exe = Get-ChildItem -Path $bin -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
if (-not $exe) { $exe = Get-ChildItem -Path $bin -Recurse -Filter 'main.exe' | Select-Object -First 1 }   # versioni vecchie
if (-not $exe) {
    Get-ChildItem -Path $bin -Recurse -Filter '*.exe' | ForEach-Object { Write-Host $_.FullName }
    throw 'Non trovo whisper-cli.exe nell''archivio: mandare a Claude l''elenco qui sopra.'
}

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
