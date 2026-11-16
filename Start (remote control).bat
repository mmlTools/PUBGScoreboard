@echo off
rem  Same as Start.bat, but also reachable from phones, tablets and other PCs on
rem  your network. The server window prints the remote-control link (with its
rem  access key). Windows Firewall may ask for permission the first time.
call "%~dp0Start.bat" --lan %*
