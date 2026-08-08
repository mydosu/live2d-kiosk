Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile("D:\CODE\Live2D\kiosk-screen.png")
Write-Output ("size: {0}x{1}" -f $img.Width, $img.Height)
$colors = @{}
for ($y = 0; $y -lt $img.Height; $y += 2) {
    for ($x = 0; $x -lt $img.Width; $x += 2) {
        $c = $img.GetPixel($x, $y)
        $r = [Math]::Floor($c.R / 32) * 32; $g = [Math]::Floor($c.G / 32) * 32; $b = [Math]::Floor($c.B / 32) * 32
        $key = '{0},{1},{2}' -f $r, $g, $b
        if ($colors.ContainsKey($key)) { $colors[$key]++ } else { $colors[$key] = 1 }
    }
}
$img.Dispose()
Write-Output "top colors:"
$colors.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10 | ForEach-Object {
    Write-Output ("{0} => {1}" -f $_.Key, $_.Value)
}
