@echo off
rem 摸鱼玻璃小局 - 一键启动（窗口隐藏运行，只弹托盘和悬浮卡片）
cd /d "%~dp0"
start "" /b node_modules\electron\dist\electron.exe .
exit
