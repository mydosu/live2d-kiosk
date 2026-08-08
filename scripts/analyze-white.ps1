Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile("D:\CODE\Live2D\k9.png")
$minX = 9999; $minY = 9999; $maxX = -1; $maxY = -1; $cnt = 0
for ($y = 0; $y -lt $img.Height; $y += 1) {
    for ($x = 0; $x -lt $img.Width; $x += 1) {
        $c = $img.GetPixel($x, $y)
        if ($c.R -gt 240 -and $c.G -gt 240 -and $c.B -gt 240) {
            if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
            $cnt++
        }
    }
}
$img.Dispose()
Write-Output ("white bbox: x=[{0}..{1}] y=[{2}..{3}] count={4}" -f $minX, $maxX, $minY, $maxY, $cnt)
