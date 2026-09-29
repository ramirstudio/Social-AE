@echo off
rem Installa il pannello Social AE in After Effects (Windows). Doppio clic sul file.
setlocal
set "SRC=%~dp0.."
set "DEST=%APPDATA%\Adobe\CEP\extensions\Social-AE"

rem Il pannello non e firmato: CEP lo carica solo in modalita debug.
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
rem Prima si toglie un eventuale collegamento (senza /s, per non toccare la cartella originale),
rem poi una vecchia copia vera e propria.
if exist "%DEST%" rmdir "%DEST%" 2>nul
if exist "%DEST%" rmdir /s /q "%DEST%"
rem Junction: come un collegamento, non servono permessi di amministratore.
mklink /J "%DEST%" "%SRC%" >nul

echo Installato in: %DEST%
echo Riavvia After Effects e apri Finestra ^> Estensioni ^> Social AE.
pause
