#Requires -Version 5.1

<#
.SYNOPSIS
Drives PartyCard TV in a running local Kodi instance using physical-key JSON-RPC input.

.DESCRIPTION
This is a development/visual-verification helper, not part of the release addon. It
connects to Kodi's localhost TCP JSON-RPC endpoint, appends every action and focus
snapshot to actions.jsonl, and deliberately provides no mouse or arbitrary-RPC
escape hatch. LaunchFixture passes one private query parameter containing an
allowlisted scenario to the same add-on ID for a separately prepared script launcher.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet(
        "LaunchAddon",
        "LaunchFixture",
        "Up",
        "Down",
        "Left",
        "Right",
        "Select",
        "Back",
        "PageUp",
        "PageDown",
        "Focus",
        "Capture",
        "QuitKodi"
    )]
    [string]$Command,

    [string]$OutputDirectory = "",

    [ValidateSet(
        "help-long",
        "help-title-hostile",
        "setup-profile-unselected",
        "setup-profile-hostile",
        "setup-paginated",
        "setup-player-profile-hostile",
        "group-member-profile-hostile",
        "setup-intensity",
        "setup-card-policy",
        "setup-card-rule-values",
        "setup-groups-hostile",
        "setup-rule-hostile",
        "setup-locale-hostile",
        "setup-taxonomy-hostile",
        "setup-review-hostile",
        "exact-search",
        "exact-search-hostile",
        "exact-card-preview-hostile",
        "servers-hostile",
        "server-details-hostile",
        "device-link-hostile",
        "home-recovery",
        "notification-hostile",
        "confirmation-exit",
        "confirmation-hostile",
        "diagnostics-long",
        "lobby-worst-first",
        "lobby-worst-middle",
        "lobby-worst-last",
        "lobby-worst-address-5",
        "lobby-max-join-url",
        "room-game-worst-first",
        "room-game-worst-middle",
        "room-game-worst-last",
        "room-game-marquee-timing",
        "room-waiting",
        "room-choice",
        "room-pool-exhausted",
        "room-reconnecting",
        "room-host-awaiting-first",
        "room-host-reconnecting",
        "room-host-awaiting-replacement",
        "room-ended-open",
        "couch-menu-four-actions",
        "couch-sync-required",
        "couch-waiting",
        "couch-choice",
        "couch-pool-exhausted",
        "couch-voters-9",
        "couch-voter-page-complete",
        "couch-voters-1000-final",
        "named-first",
        "named-middle",
        "named-last",
        "couch-classification-hostile",
        "anonymous-aggregate-result",
        "conversation-meta-card",
        "private-choice",
        "private-choice-anonymous"
    )]
    [string]$Scenario,

    [ValidateSet("en-GB", "de-DE")]
    [string]$Locale = "en-GB",

    [string]$ScreenshotName = "",

    [ValidateRange(0, 5000)]
    [int]$SettleMilliseconds = 250,

    [ValidateRange(1, 60)]
    [int]$TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:KodiHost = "127.0.0.1"
$script:KodiPort = 9090
$script:AddonId = "script.partycard.tv"
$script:DirectLaunchQueryKey = "partycard_direct_launch"
$script:FixtureQueryKey = "partycard_visual_fixture"
$script:FixtureLocaleQueryKey = "partycard_visual_locale"
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:RunId = [Guid]::NewGuid().ToString("N")
$script:KnownControlIds = @(
    49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
    80, 81,
    90, 91, 92, 93, 94, 95, 96, 97, 98,
    100, 101, 102, 103, 104, 105, 106, 107
)
$script:ListControlIds = @(
    50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64
)
$script:WindowPropertyNames = @(
    "ClientReady",
    "ViewMode",
    "Heading",
    "Body",
    "Alert",
    "Progress",
    "PageStatus",
    "PagePreviousLabel",
    "PageNextLabel",
    "PagePreviousEnabled",
    "PageNextEnabled",
    "HasPagination",
    "HasItems",
    "HasActions",
    "CanGoBack",
    "HelpVisible",
    "ActiveStage",
    "CardPageStatus",
    "HasCardPages",
    "CardPagePreviousEnabled",
    "CardPageNextEnabled",
    "CardText",
    "CardTextFit",
    "CurrentPlayer",
    "CardEyebrow",
    "CardClassification",
    "Atmosphere",
    "AtmosphereTexture",
    "AdaptiveTone",
    "PrivateVoteChoice",
    "PrivateVoteYesLabel",
    "PrivateVoteNoLabel",
    "PrivateVoteCancelLabel",
    "HasVoters",
    "VoterPagination",
    "VotingStageLabel",
    "VotingPlayer",
    "VotingHint",
    "JoinUrls",
    "JoinUrlStatus",
    "ResultYes",
    "ResultNo",
    "ResultYesNames",
    "ResultNoNames",
    "ResultStatus",
    "ResultVisible",
    "HasNamedResults",
    "HasRoster",
    "ConfirmVisible",
    "ConfirmTitle",
    "ConfirmBody",
    "Notification",
    "ServerPill",
    "RoomCode",
    "Footer"
)

function Get-RepositoryRoot {
    $toolsDirectory = Get-Item -LiteralPath $PSScriptRoot
    return $toolsDirectory.Parent.Parent.Parent.FullName
}

function Resolve-DriverOutputDirectory {
    param([string]$RequestedPath)

    if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
        $requestedFullPath = Join-Path (Get-RepositoryRoot) "artifacts/kodi-dpad-verification"
    }
    else {
        $requestedFullPath = [IO.Path]::GetFullPath($RequestedPath)
    }

    [void](New-Item -ItemType Directory -Path $requestedFullPath -Force)
    return (Get-Item -LiteralPath $requestedFullPath).FullName
}

function Get-ObjectPropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $InputObject) {
        return $null
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Get-CompleteJsonFrame {
    param([Parameter(Mandatory = $true)][string]$Buffer)

    $start = -1
    for ($index = 0; $index -lt $Buffer.Length; $index += 1) {
        $character = $Buffer[$index]
        if ($character -eq [char]"{" -or $character -eq [char]"[") {
            $start = $index
            break
        }
    }
    if ($start -lt 0) {
        return $null
    }

    $depth = 0
    $insideString = $false
    $escaped = $false
    for ($index = $start; $index -lt $Buffer.Length; $index += 1) {
        $character = $Buffer[$index]
        if ($insideString) {
            if ($escaped) {
                $escaped = $false
                continue
            }
            if ($character -eq [char]"\") {
                $escaped = $true
                continue
            }
            if ($character -eq [char]'"') {
                $insideString = $false
            }
            continue
        }

        if ($character -eq [char]'"') {
            $insideString = $true
            continue
        }
        if ($character -eq [char]"{" -or $character -eq [char]"[") {
            $depth += 1
            continue
        }
        if ($character -eq [char]"}" -or $character -eq [char]"]") {
            $depth -= 1
            if ($depth -eq 0) {
                $end = $index + 1
                return [pscustomobject][ordered]@{
                    Frame = $Buffer.Substring($start, $end - $start)
                    Remainder = $Buffer.Substring($end)
                }
            }
        }
    }
    return $null
}

function Invoke-KodiRpc {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [AllowNull()][object]$Parameters,
        [Parameter(Mandatory = $true)][int]$RequestTimeoutSeconds
    )

    $requestId = [Guid]::NewGuid().ToString("N")
    $request = [ordered]@{
        jsonrpc = "2.0"
        method = $Method
        id = $requestId
    }
    if ($PSBoundParameters.ContainsKey("Parameters") -and $null -ne $Parameters) {
        $request.params = $Parameters
    }
    $requestJson = ($request | ConvertTo-Json -Depth 20 -Compress) + "`n"
    $requestBytes = $script:Utf8NoBom.GetBytes($requestJson)

    $client = New-Object System.Net.Sockets.TcpClient
    $stream = $null
    try {
        $connect = $client.BeginConnect($script:KodiHost, $script:KodiPort, $null, $null)
        try {
            if (-not $connect.AsyncWaitHandle.WaitOne($RequestTimeoutSeconds * 1000)) {
                throw "Kodi JSON-RPC connection timed out at $($script:KodiHost):$($script:KodiPort)."
            }
            $client.EndConnect($connect)
        }
        finally {
            $connect.AsyncWaitHandle.Close()
        }

        $client.NoDelay = $true
        $stream = $client.GetStream()
        $stream.ReadTimeout = $RequestTimeoutSeconds * 1000
        $stream.WriteTimeout = $RequestTimeoutSeconds * 1000
        $stream.Write($requestBytes, 0, $requestBytes.Length)
        $stream.Flush()

        $buffer = New-Object byte[] 8192
        $pending = ""
        while ($true) {
            $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
            if ($bytesRead -eq 0) {
                throw "Kodi closed the JSON-RPC connection before replying to $Method."
            }
            $pending += [Text.Encoding]::UTF8.GetString($buffer, 0, $bytesRead)

            while ($true) {
                $frame = Get-CompleteJsonFrame -Buffer $pending
                if ($null -eq $frame) {
                    break
                }
                $pending = $frame.Remainder
                $message = $frame.Frame | ConvertFrom-Json
                $messageId = Get-ObjectPropertyValue -InputObject $message -Name "id"
                if ([string]$messageId -ne $requestId) {
                    continue
                }

                $rpcError = Get-ObjectPropertyValue -InputObject $message -Name "error"
                if ($null -ne $rpcError) {
                    $errorJson = $rpcError | ConvertTo-Json -Depth 20 -Compress
                    throw "Kodi JSON-RPC method $Method failed: $errorJson"
                }
                return (Get-ObjectPropertyValue -InputObject $message -Name "result")
            }
        }
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        $client.Dispose()
    }
}

function Test-BooleanValue {
    param([AllowNull()][object]$Value)

    if ($Value -is [bool]) {
        return $Value
    }
    return [string]::Equals([string]$Value, "true", [StringComparison]::OrdinalIgnoreCase)
}

function Get-KodiFocusSnapshot {
    $gui = Invoke-KodiRpc -Method "GUI.GetProperties" -Parameters ([ordered]@{
        properties = @("currentwindow", "currentcontrol")
    }) -RequestTimeoutSeconds $TimeoutSeconds

    $booleanNames = @(
        foreach ($controlId in $script:KnownControlIds) {
            "Control.HasFocus($controlId)"
        }
    )
    $booleans = Invoke-KodiRpc -Method "XBMC.GetInfoBooleans" -Parameters ([ordered]@{
        booleans = $booleanNames
    }) -RequestTimeoutSeconds $TimeoutSeconds

    $labelNames = New-Object System.Collections.Generic.List[string]
    [void]$labelNames.Add("System.CurrentWindow")
    [void]$labelNames.Add("System.CurrentControl")
    foreach ($propertyName in $script:WindowPropertyNames) {
        [void]$labelNames.Add("Window.Property($propertyName)")
    }
    foreach ($controlId in $script:ListControlIds) {
        [void]$labelNames.Add("Container($controlId).ListItem.Property(ActionId)")
        [void]$labelNames.Add("Container($controlId).ListItem.Label")
        [void]$labelNames.Add("Container($controlId).ListItem.Label2")
    }
    foreach ($controlId in $script:KnownControlIds) {
        [void]$labelNames.Add("Control.GetLabel($controlId)")
    }
    $labels = Invoke-KodiRpc -Method "XBMC.GetInfoLabels" -Parameters ([ordered]@{
        labels = $labelNames.ToArray()
    }) -RequestTimeoutSeconds $TimeoutSeconds

    $focusedControlIds = @(
        foreach ($controlId in $script:KnownControlIds) {
            $query = "Control.HasFocus($controlId)"
            if (Test-BooleanValue (Get-ObjectPropertyValue -InputObject $booleans -Name $query)) {
                $controlId
            }
        }
    )
    $focusedControlId = $null
    if ($focusedControlIds.Count -eq 1) {
        $focusedControlId = $focusedControlIds[0]
    }

    $windowProperties = [ordered]@{}
    foreach ($propertyName in $script:WindowPropertyNames) {
        $query = "Window.Property($propertyName)"
        $windowProperties[$propertyName] = Get-ObjectPropertyValue -InputObject $labels -Name $query
    }

    $semanticActionIds = [ordered]@{}
    $selectedItems = [ordered]@{}
    foreach ($controlId in $script:ListControlIds) {
        $actionQuery = "Container($controlId).ListItem.Property(ActionId)"
        $labelQuery = "Container($controlId).ListItem.Label"
        $label2Query = "Container($controlId).ListItem.Label2"
        $actionId = Get-ObjectPropertyValue -InputObject $labels -Name $actionQuery
        if (-not [string]::IsNullOrWhiteSpace([string]$actionId)) {
            $semanticActionIds[[string]$controlId] = $actionId
        }
        $itemLabel = Get-ObjectPropertyValue -InputObject $labels -Name $labelQuery
        $itemLabel2 = Get-ObjectPropertyValue -InputObject $labels -Name $label2Query
        if (-not [string]::IsNullOrWhiteSpace([string]$itemLabel) -or
            -not [string]::IsNullOrWhiteSpace([string]$itemLabel2)) {
            $selectedItems[[string]$controlId] = [ordered]@{
                label = $itemLabel
                label2 = $itemLabel2
            }
        }
    }

    $controlLabels = [ordered]@{}
    foreach ($controlId in $script:KnownControlIds) {
        $query = "Control.GetLabel($controlId)"
        $label = Get-ObjectPropertyValue -InputObject $labels -Name $query
        if (-not [string]::IsNullOrWhiteSpace([string]$label)) {
            $controlLabels[[string]$controlId] = $label
        }
    }

    $focusedSemanticActionId = $null
    $focusedControlLabel = $null
    if ($null -ne $focusedControlId) {
        $focusedKey = [string]$focusedControlId
        if ($semanticActionIds.Contains($focusedKey)) {
            $focusedSemanticActionId = $semanticActionIds[$focusedKey]
        }
        if ($controlLabels.Contains($focusedKey)) {
            $focusedControlLabel = $controlLabels[$focusedKey]
        }
    }

    return [pscustomobject][ordered]@{
        timestampUtc = [DateTime]::UtcNow.ToString("o")
        currentWindow = Get-ObjectPropertyValue -InputObject $gui -Name "currentwindow"
        currentControl = Get-ObjectPropertyValue -InputObject $gui -Name "currentcontrol"
        systemCurrentWindow = Get-ObjectPropertyValue -InputObject $labels -Name "System.CurrentWindow"
        systemCurrentControl = Get-ObjectPropertyValue -InputObject $labels -Name "System.CurrentControl"
        focusedControlId = $focusedControlId
        focusedControlIds = $focusedControlIds
        focusedControlLabel = $focusedControlLabel
        focusedSemanticActionId = $focusedSemanticActionId
        semanticActionIds = $semanticActionIds
        selectedItems = $selectedItems
        controlLabels = $controlLabels
        windowProperties = $windowProperties
    }
}

function Write-JsonLine {
    param([Parameter(Mandatory = $true)][object]$Record)

    $json = $Record | ConvertTo-Json -Depth 30 -Compress
    [IO.File]::AppendAllText(
        $script:TracePath,
        $json + [Environment]::NewLine,
        $script:Utf8NoBom
    )
}

function Write-ActionRecord {
    param(
        [Parameter(Mandatory = $true)][string]$ActionName,
        [Parameter(Mandatory = $true)][string]$RpcMethod,
        [AllowNull()][object]$Result,
        [AllowNull()][object]$Details
    )

    Write-JsonLine ([ordered]@{
        timestampUtc = [DateTime]::UtcNow.ToString("o")
        runId = $script:RunId
        kind = "action"
        command = $ActionName
        rpcMethod = $RpcMethod
        result = $Result
        details = $Details
    })
}

function Write-FocusRecord {
    param(
        [Parameter(Mandatory = $true)][string]$AfterCommand,
        [Parameter(Mandatory = $true)][object]$Snapshot
    )

    Write-JsonLine ([ordered]@{
        timestampUtc = [DateTime]::UtcNow.ToString("o")
        runId = $script:RunId
        kind = "focus"
        afterCommand = $AfterCommand
        snapshot = $Snapshot
    })
}

function Wait-KodiAddonReady {
    param([Parameter(Mandatory = $true)][string]$AfterCommand)

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastSnapshot = $null
    $previousSignature = $null
    do {
        if ($SettleMilliseconds -gt 0) {
            Start-Sleep -Milliseconds $SettleMilliseconds
        }
        $lastSnapshot = Get-KodiFocusSnapshot
        $clientReady = $lastSnapshot.windowProperties["ClientReady"]
        $viewMode = [string]$lastSnapshot.windowProperties["ViewMode"]
        $heading = [string]$lastSnapshot.windowProperties["Heading"]
        $hasFocus = $null -ne $lastSnapshot.focusedControlId
        if ((Test-BooleanValue $clientReady) -and
            -not [string]::IsNullOrWhiteSpace($viewMode) -and
            -not [string]::IsNullOrWhiteSpace($heading) -and
            $hasFocus) {
            $properties = $lastSnapshot.windowProperties
            $signature = @(
                $viewMode,
                $heading,
                [string]$properties["PageStatus"],
                [string]$properties["CardPageStatus"],
                [string]$properties["Footer"],
                [string]$properties["CurrentPlayer"],
                [string]$properties["PrivateVoteChoice"],
                [string]$properties["VotingPlayer"],
                [string]$properties["VoterPagination"],
                [string]$lastSnapshot.focusedControlId,
                [string]$lastSnapshot.focusedSemanticActionId
            ) -join "|"
            if ($signature -eq $previousSignature) {
                return $lastSnapshot
            }
            $previousSignature = $signature
        }
        else {
            $previousSignature = $null
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($null -ne $lastSnapshot) {
        Write-FocusRecord -AfterCommand $AfterCommand -Snapshot $lastSnapshot
    }
    throw "PartyCard TV did not report ClientReady=true within $TimeoutSeconds seconds."
}

function Get-ValidatedScreenshotName {
    param([string]$RequestedName)

    if ([string]::IsNullOrWhiteSpace($RequestedName)) {
        return "kodi-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')).png"
    }
    if ([IO.Path]::GetFileName($RequestedName) -ne $RequestedName) {
        throw "ScreenshotName must be a file name without a directory path."
    }
    if ($RequestedName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        throw "ScreenshotName contains characters that are invalid in a file name."
    }

    $extension = [IO.Path]::GetExtension($RequestedName)
    if ([string]::IsNullOrEmpty($extension)) {
        return "$RequestedName.png"
    }
    if (-not [string]::Equals($extension, ".png", [StringComparison]::OrdinalIgnoreCase)) {
        throw "ScreenshotName must use the .png extension."
    }
    return $RequestedName
}

function Get-PngFileState {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $state = @{}
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter "*.png" -File) {
        $state[$file.FullName] = "$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
    }
    return $state
}

function Find-NewScreenshot {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][hashtable]$PreviousState
    )

    $candidates = @(
        foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter "*.png" -File) {
            $stamp = "$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
            if (-not $PreviousState.ContainsKey($file.FullName) -or
                $PreviousState[$file.FullName] -ne $stamp) {
                $file
            }
        }
    )
    if ($candidates.Count -eq 0) {
        return $null
    }
    return $candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
}

function Wait-PngFileStable {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][DateTime]$Deadline
    )

    $previousLength = -1L
    $stableObservations = 0
    do {
        Start-Sleep -Milliseconds 100
        $current = Get-Item -LiteralPath $Path
        if ($current.Length -gt 0 -and $current.Length -eq $previousLength) {
            $stableObservations += 1
            if ($stableObservations -ge 2) {
                return $current
            }
        }
        else {
            $stableObservations = 0
        }
        $previousLength = $current.Length
    } while ([DateTime]::UtcNow -lt $Deadline)

    throw "Kodi's PNG screenshot did not finish writing within $TimeoutSeconds seconds."
}

function Save-KodiScreenshot {
    param([Parameter(Mandatory = $true)][string]$RequestedName)

    $safeName = Get-ValidatedScreenshotName -RequestedName $RequestedName
    $destination = Join-Path $script:ResolvedOutputDirectory $safeName
    if (Test-Path -LiteralPath $destination) {
        throw "Refusing to overwrite existing screenshot: $destination"
    }

    $setting = Invoke-KodiRpc -Method "Settings.GetSettingValue" -Parameters ([ordered]@{
        setting = "debug.screenshotpath"
    }) -RequestTimeoutSeconds $TimeoutSeconds
    $originalPath = Get-ObjectPropertyValue -InputObject $setting -Name "value"
    if ($null -eq $originalPath) {
        $originalPath = ""
    }

    $captureError = $null
    $restoreError = $null
    $capturedPath = $null
    $screenshotResult = $null
    $previousState = Get-PngFileState -Directory $script:ResolvedOutputDirectory
    $temporaryPath = $script:ResolvedOutputDirectory
    if (-not $temporaryPath.EndsWith([string][IO.Path]::DirectorySeparatorChar)) {
        $temporaryPath += [IO.Path]::DirectorySeparatorChar
    }

    try {
        [void](Invoke-KodiRpc -Method "Settings.SetSettingValue" -Parameters ([ordered]@{
            setting = "debug.screenshotpath"
            value = $temporaryPath
        }) -RequestTimeoutSeconds $TimeoutSeconds)

        $screenshotResult = Invoke-KodiRpc -Method "Input.ExecuteAction" -Parameters ([ordered]@{
            action = "screenshot"
        }) -RequestTimeoutSeconds $TimeoutSeconds
        Write-ActionRecord -ActionName "Capture" -RpcMethod "Input.ExecuteAction" -Result $screenshotResult -Details ([ordered]@{
            action = "screenshot"
            requestedPath = $destination
        })

        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        $candidate = $null
        do {
            Start-Sleep -Milliseconds 100
            $candidate = Find-NewScreenshot -Directory $script:ResolvedOutputDirectory -PreviousState $previousState
        } while ($null -eq $candidate -and [DateTime]::UtcNow -lt $deadline)

        if ($null -eq $candidate) {
            throw "Kodi did not write a PNG screenshot within $TimeoutSeconds seconds."
        }

        $candidate = Wait-PngFileStable -Path $candidate.FullName -Deadline $deadline
        if ([string]::Equals($candidate.FullName, $destination, [StringComparison]::OrdinalIgnoreCase)) {
            $capturedPath = $candidate.FullName
        }
        else {
            Move-Item -LiteralPath $candidate.FullName -Destination $destination
            $capturedPath = (Get-Item -LiteralPath $destination).FullName
        }
    }
    catch {
        $captureError = $_
    }
    finally {
        try {
            [void](Invoke-KodiRpc -Method "Settings.SetSettingValue" -Parameters ([ordered]@{
                setting = "debug.screenshotpath"
                value = [string]$originalPath
            }) -RequestTimeoutSeconds $TimeoutSeconds)
        }
        catch {
            $restoreError = $_
        }
    }

    if ($null -ne $restoreError) {
        $captureMessage = ""
        if ($null -ne $captureError) {
            $captureMessage = " Capture also failed: $($captureError.Exception.Message)"
        }
        throw "Kodi screenshot path could not be restored to its original value.$captureMessage Restore failed: $($restoreError.Exception.Message)"
    }
    if ($null -ne $captureError) {
        throw $captureError
    }

    return [pscustomobject][ordered]@{
        rpcResult = $screenshotResult
        path = $capturedPath
    }
}

$script:ResolvedOutputDirectory = Resolve-DriverOutputDirectory -RequestedPath $OutputDirectory
$script:TracePath = Join-Path $script:ResolvedOutputDirectory "actions.jsonl"

$navigationMethods = @{
    Up = "Input.Up"
    Down = "Input.Down"
    Left = "Input.Left"
    Right = "Input.Right"
    Select = "Input.Select"
    Back = "Input.Back"
}
$dedicatedKeyActions = @{
    PageUp = "pageup"
    PageDown = "pagedown"
}

try {
    if ($navigationMethods.ContainsKey($Command)) {
        $method = $navigationMethods[$Command]
        $result = Invoke-KodiRpc -Method $method -Parameters $null -RequestTimeoutSeconds $TimeoutSeconds
        Write-ActionRecord -ActionName $Command -RpcMethod $method -Result $result -Details $null
        if ($SettleMilliseconds -gt 0) {
            Start-Sleep -Milliseconds $SettleMilliseconds
        }
        $snapshot = Get-KodiFocusSnapshot
        Write-FocusRecord -AfterCommand $Command -Snapshot $snapshot
        Write-Output ($snapshot | ConvertTo-Json -Depth 30)
    }
    elseif ($dedicatedKeyActions.ContainsKey($Command)) {
        $action = $dedicatedKeyActions[$Command]
        $result = Invoke-KodiRpc -Method "Input.ExecuteAction" -Parameters ([ordered]@{
            action = $action
        }) -RequestTimeoutSeconds $TimeoutSeconds
        Write-ActionRecord -ActionName $Command -RpcMethod "Input.ExecuteAction" -Result $result -Details ([ordered]@{
            action = $action
            physicalKey = $Command
        })
        if ($SettleMilliseconds -gt 0) {
            Start-Sleep -Milliseconds $SettleMilliseconds
        }
        $snapshot = Get-KodiFocusSnapshot
        Write-FocusRecord -AfterCommand $Command -Snapshot $snapshot
        Write-Output ($snapshot | ConvertTo-Json -Depth 30)
    }
    elseif ($Command -eq "LaunchAddon") {
        $launchParameters = [ordered]@{}
        $launchParameters[$script:DirectLaunchQueryKey] = "1"
        $result = Invoke-KodiRpc -Method "Addons.ExecuteAddon" -Parameters ([ordered]@{
            addonid = $script:AddonId
            params = $launchParameters
            wait = $false
        }) -RequestTimeoutSeconds $TimeoutSeconds
        Write-ActionRecord -ActionName $Command -RpcMethod "Addons.ExecuteAddon" -Result $result -Details ([ordered]@{
            addonId = $script:AddonId
        })
        $snapshot = Wait-KodiAddonReady -AfterCommand $Command
        Write-FocusRecord -AfterCommand $Command -Snapshot $snapshot
        Write-Output ($snapshot | ConvertTo-Json -Depth 30)
    }
    elseif ($Command -eq "LaunchFixture") {
        if (-not $PSBoundParameters.ContainsKey("Scenario")) {
            throw "LaunchFixture requires -Scenario with an allowlisted fixture name."
        }
        $fixtureParameters = [ordered]@{}
        $fixtureParameters[$script:FixtureQueryKey] = $Scenario
        $fixtureParameters[$script:FixtureLocaleQueryKey] = $Locale
        $result = Invoke-KodiRpc -Method "Addons.ExecuteAddon" -Parameters ([ordered]@{
            addonid = $script:AddonId
            params = $fixtureParameters
            wait = $false
        }) -RequestTimeoutSeconds $TimeoutSeconds
        Write-ActionRecord -ActionName $Command -RpcMethod "Addons.ExecuteAddon" -Result $result -Details ([ordered]@{
            addonId = $script:AddonId
            scenario = $Scenario
            locale = $Locale
        })
        $snapshot = Wait-KodiAddonReady -AfterCommand $Command
        Write-FocusRecord -AfterCommand $Command -Snapshot $snapshot
        Write-Output ($snapshot | ConvertTo-Json -Depth 30)
    }
    elseif ($Command -eq "Focus") {
        $snapshot = Get-KodiFocusSnapshot
        Write-FocusRecord -AfterCommand $Command -Snapshot $snapshot
        Write-Output ($snapshot | ConvertTo-Json -Depth 30)
    }
    elseif ($Command -eq "Capture") {
        $capture = Save-KodiScreenshot -RequestedName $ScreenshotName
        $snapshot = Get-KodiFocusSnapshot
        Write-FocusRecord -AfterCommand $Command -Snapshot $snapshot
        Write-Output ([ordered]@{
            screenshot = $capture.path
            focus = $snapshot
        } | ConvertTo-Json -Depth 30)
    }
    elseif ($Command -eq "QuitKodi") {
        $result = Invoke-KodiRpc -Method "Application.Quit" -Parameters $null -RequestTimeoutSeconds $TimeoutSeconds
        Write-ActionRecord -ActionName $Command -RpcMethod "Application.Quit" -Result $result -Details $null
        Write-Output "Kodi accepted the graceful Application.Quit request."
    }
}
catch {
    try {
        Write-JsonLine ([ordered]@{
            timestampUtc = [DateTime]::UtcNow.ToString("o")
            runId = $script:RunId
            kind = "error"
            command = $Command
            message = $_.Exception.Message
        })
    }
    catch {
        # Preserve the operational error when even the diagnostic trace cannot be written.
    }
    throw
}
