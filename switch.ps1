# switch.ps1
# ---------------------------------------------------------------------------
# Safely hand the Clip project back and forth between Cursor and Antigravity.
#
# THE GOLDEN RULE: only ONE editor's AI agent should edit the project at a
# time. Use this script to pass the baton through GitHub so nothing gets lost.
#
# HOW TO USE:
#   - Finishing in an editor (about to switch)  -> run this, choose "1 Leaving"
#   - Starting in an editor (just opened it)     -> run this, choose "2 Arriving"
#
# To run it: open the PowerShell terminal in your editor and type:
#   swap            (works from any folder - defined in your PowerShell profile)
# or, from inside the Clip folder:
#   ./switch.ps1
# ---------------------------------------------------------------------------

# Always work from the folder this script lives in, no matter where it's run.
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Clip  -  Editor Switch Helper" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# --- Safety check: are we actually in the git project? ---------------------
git rev-parse --is-inside-work-tree 2>$null | Out-Null
if (-not $?) {
    Write-Host "X  This folder isn't a Git project, so I can't sync it." -ForegroundColor Red
    Write-Host "   Make sure you're running this from the Clip folder." -ForegroundColor Red
    exit 1
}

# --- Ask what the user is doing --------------------------------------------
Write-Host "What are you doing right now?"
Write-Host ""
Write-Host "  1  Leaving this editor   (save my work & send it to GitHub)" -ForegroundColor Yellow
Write-Host "  2  Arriving at this editor (get the latest work from GitHub)" -ForegroundColor Green
Write-Host "  3  Cancel" -ForegroundColor DarkGray
Write-Host ""
$choice = Read-Host "Type 1, 2, or 3 and press Enter"

switch ($choice) {

    # ===================== LEAVING: save & push ============================
    "1" {
        Write-Host ""
        Write-Host ">> Saving your work and sending it to GitHub..." -ForegroundColor Yellow

        # Is there anything to save?
        $changes = git status --porcelain
        if ([string]::IsNullOrWhiteSpace($changes)) {
            Write-Host "   Nothing has changed since your last save." -ForegroundColor DarkGray
            Write-Host "   Checking GitHub is up to date anyway..." -ForegroundColor DarkGray
            git push
            Write-Host ""
            Write-Host "OK  Everything is already saved. Safe to switch editors." -ForegroundColor Green
            break
        }

        # Show what changed, then stage it.
        Write-Host ""
        Write-Host "   These files changed:" -ForegroundColor DarkGray
        git status --short
        git add -A

        # Ask for a short note (with a sensible default).
        Write-Host ""
        $msg = Read-Host "In a few words, what did you change? (press Enter to skip)"
        if ([string]::IsNullOrWhiteSpace($msg)) {
            $msg = "Update from editor switch on " + (Get-Date -Format "yyyy-MM-dd HH:mm")
        }

        git commit -m $msg
        if (-not $?) {
            Write-Host "X  Couldn't save (commit failed). Nothing was sent." -ForegroundColor Red
            break
        }

        git push
        if (-not $?) {
            Write-Host ""
            Write-Host "!  Saved on your computer, but couldn't send it to GitHub." -ForegroundColor Red
            Write-Host "   Your work is safe locally - nothing was lost." -ForegroundColor Red
            Write-Host "   Most common cause: the OTHER editor pushed newer work first." -ForegroundColor Red
            Write-Host "   Try this: run the script again, choose '2 Arriving' to pull," -ForegroundColor Red
            Write-Host "   then choose '1 Leaving' to send yours." -ForegroundColor Red
            Write-Host "   If that doesn't fix it, check your internet connection, that" -ForegroundColor Red
            Write-Host "   you're signed in to GitHub, and read the message above." -ForegroundColor Red
            break
        }

        Write-Host ""
        Write-Host "OK  Work saved and sent to GitHub. Safe to switch editors." -ForegroundColor Green
    }

    # ===================== ARRIVING: pull =================================
    "2" {
        Write-Host ""
        Write-Host ">> Getting the latest work from GitHub..." -ForegroundColor Green

        # Warn if there are unsaved local changes that a pull might disturb.
        $changes = git status --porcelain
        if (-not [string]::IsNullOrWhiteSpace($changes)) {
            Write-Host ""
            Write-Host "!  You have unsaved changes in THIS editor:" -ForegroundColor Yellow
            git status --short
            Write-Host ""
            Write-Host "   Getting the latest now could clash with these." -ForegroundColor Yellow
            $ans = Read-Host "   Continue anyway? (y/N)"
            if ($ans -ne "y" -and $ans -ne "Y") {
                Write-Host "   Cancelled. Tip: choose '1 Leaving' first to save them." -ForegroundColor DarkGray
                break
            }
        }

        git pull
        if (-not $?) {
            Write-Host ""
            Write-Host "!  Couldn't merge the latest cleanly." -ForegroundColor Red
            Write-Host "   This can happen if both editors changed the same lines." -ForegroundColor Red
            Write-Host "   Ask Claude (in Cursor) to help sort it out before editing." -ForegroundColor Red
            break
        }

        Write-Host ""
        Write-Host "OK  You're up to date. Good to start editing here." -ForegroundColor Green
    }

    # ===================== CANCEL =========================================
    "3" {
        Write-Host "Cancelled. Nothing was changed." -ForegroundColor DarkGray
    }

    default {
        Write-Host "I didn't understand '$choice'. Run the script again and type 1, 2, or 3." -ForegroundColor Red
    }
}

Write-Host ""
