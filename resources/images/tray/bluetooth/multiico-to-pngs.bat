@echo off
setlocal EnableDelayedExpansion

for %%F in (%*) do (
    echo Processing: %%~nxF

    set "filepath=%%~fF"
    set "filename=%%~nF"
    set "filedir=%%~dpF"
    set "outdir=!filedir!!filename!"

    if not exist "!outdir!" mkdir "!outdir!"

    set count=0

    for /f %%A in ('magick identify "!filepath!" ^| find /c /v ""') do (
        set count=%%A
    )

    if !count! LSS 4 (
        echo   Not enough frames found in %%~nxF
    ) else (
        set /a start=!count!-4
        set idx=0

        for /L %%I in (!start!,1,!count!-1) do (
            for /f %%S in ('magick identify -format "%%w" "!filepath![%%I]"') do (
                echo   Exporting %%S.png from frame %%I
                magick "!filepath![%%I]" "!outdir!\%%S.png"
            )
        )
    )
)

echo Done!
pause