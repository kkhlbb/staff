@echo off
setlocal DisableDelayedExpansion
set "NODE_OPTIONS="
set "ELECTRON_NO_ASAR="
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0m1-peer.exe" launch
exit /b %errorlevel%
