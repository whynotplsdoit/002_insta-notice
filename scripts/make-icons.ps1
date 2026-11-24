# Make web icons from the original logo (assets/logo.png).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
#
# favicon-32 : browser tab (rounded corners)
# favicon-64 : header logo, 2x for sharp screens (rounded corners)
# apple-touch-icon : iPhone home screen (square: iOS rounds it, transparency turns black)
# icon-192 / icon-512 : Android home screen, app install (square: the OS applies its own shape)
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'assets\logo.png'
$out = Join-Path $root 'web\public'
$RADIUS = 0.22  # corner radius as a ratio of the icon size

$icons = @(
  @{ Name = 'favicon-32.png'; Size = 32; Round = $true },
  @{ Name = 'favicon-64.png'; Size = 64; Round = $true },
  @{ Name = 'apple-touch-icon.png'; Size = 180; Round = $false },
  @{ Name = 'icon-192.png'; Size = 192; Round = $false },
  @{ Name = 'icon-512.png'; Size = 512; Round = $false }
)

function Resize($img, $n) {
  $bmp = New-Object System.Drawing.Bitmap $n, $n
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $n, $n)
  $g.Dispose()
  return $bmp
}

function RoundCorners($bmp) {
  $n = $bmp.Width
  $r = [Math]::Max(2, [int]($n * $RADIUS)) * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $r, $r, 180, 90)
  $path.AddArc($n - $r, 0, $r, $r, 270, 90)
  $path.AddArc($n - $r, $n - $r, $r, $r, 0, 90)
  $path.AddArc(0, $n - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $res = New-Object System.Drawing.Bitmap $n, $n, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($res)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $brush = New-Object System.Drawing.TextureBrush $bmp
  $g.FillPath($brush, $path)
  $brush.Dispose(); $g.Dispose(); $path.Dispose()
  return $res
}

# Maskable icon for Android home screen: logo at 80% on the brand navy (#20203E),
# so circle/squircle masks never cut the logo.
function Maskable($img, $n) {
  $bmp = New-Object System.Drawing.Bitmap $n, $n
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255, 0x20, 0x20, 0x3E))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $inner = [int]($n * 0.8)
  $off = [int](($n - $inner) / 2)
  $g.DrawImage($img, $off, $off, $inner, $inner)
  $g.Dispose()
  return $bmp
}

$img = [System.Drawing.Image]::FromFile($src)
try {
  $m = Maskable $img 512
  $m.Save((Join-Path $out 'icon-maskable-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $m.Dispose()
  Write-Output 'icon-maskable-512.png (512px, maskable)'

  foreach ($icon in $icons) {
    $bmp = Resize $img $icon.Size
    if ($icon.Round) {
      $rounded = RoundCorners $bmp
      $bmp.Dispose()
      $bmp = $rounded
    }
    $bmp.Save((Join-Path $out $icon.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "$($icon.Name) ($($icon.Size)px, rounded=$($icon.Round))"
  }
} finally {
  $img.Dispose()
}
