Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile("D:\CODE\Live2D\k5.png")
$minX = 9999; $minY = 9999; $maxX = -1; $maxY = -1
$sumX = 0; $sumY = 0; $cnt = 0
for ($y = 0; $y -lt $img.Height; $y += 2) {
    for ($x = 0; $x -lt $img.Width; $x += 2) {
        $c = $img.GetPixel($x, $y)
        if (($c.R + $c.G + $c.B) -gt 450) {
            if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
            $sumX += $x; $sumY += $y; $cnt++
        }
    }
}
Write-Output ("image: {0}x{1}" -f $img.Width, $img.Height)
$img.Dispose()
if ($cnt -gt 0) {
    Write-Output ("model bbox: x=[{0}..{1}] y=[{2}..{3}]" -f $minX, $maxX, $minY, $maxY)
    Write-Output ("center: ({0},{1})" -f [Math]::Round($sumX/$cnt), [Math]::Round($sumY/$cnt))
}
