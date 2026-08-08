Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile("D:\CODE\Live2D\kiosk-screen3.png")
Write-Output ("size: {0}x{1}" -f $img.Width, $img.Height)
$light = 0; $total = 0
for ($y = 0; $y -lt $img.Height; $y += 2) {
    for ($x = 0; $x -lt $img.Width; $x += 2) {
        $c = $img.GetPixel($x, $y); $total++
        if (($c.R + $c.G + $c.B) -gt 450) { $light++ }
    }
}
$img.Dispose()
Write-Output ("亮色占比: {0:P1} (模型区域)" -f ($light / $total))
