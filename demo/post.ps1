# Cut the handoff wait out of the recording, then encode a clean 1280x720 mp4.
param(
  [string]$In,
  [string]$Out = "demo.mp4"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ff = "C:\Users\Administrator\.agent-reach\tools\ffmpeg\bin\ffmpeg.exe"
$m = Get-Content (Join-Path $here "markers.json") -Raw | ConvertFrom-Json

if (-not $In) {
  $In = (Get-ChildItem (Join-Path $here "raw\*.webm") | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

$tA = [math]::Round((($m.waitStart - $m.videoStart) / 1000) + 0.6, 2)
$tB = [math]::Round((($m.waitEnd - $m.videoStart) / 1000) - 0.3, 2)
"input  $In"
"cut    keep 0..$tA s, then $tB s..end"

$seg1 = Join-Path $here "seg1.mp4"
$seg2 = Join-Path $here "seg2.mp4"

& $ff -y -hide_banner -loglevel error -i $In -t $tA -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -threads 2 $seg1
if ($LASTEXITCODE -ne 0) { throw "segment 1 failed" }
& $ff -y -hide_banner -loglevel error -ss $tB -i $In -vf "scale=1280:720:flags=lanczos,fps=30" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -threads 2 $seg2
if ($LASTEXITCODE -ne 0) { throw "segment 2 failed" }

$list = Join-Path $here "concat.txt"
@("file '$seg1'", "file '$seg2'") | Set-Content $list -Encoding ASCII
$outPath = Join-Path $here $Out
& $ff -y -hide_banner -loglevel error -f concat -safe 0 -i $list -c copy -movflags +faststart $outPath
if ($LASTEXITCODE -ne 0) { throw "concat failed" }

Remove-Item $seg1, $seg2, $list -Force
& $ff -hide_banner -i $outPath 2>&1 | Select-String "Duration|Stream" | ForEach-Object { $_.Line.Trim() }
"size: " + [math]::Round((Get-Item $outPath).Length / 1MB, 1) + " MB"
