package expo.modules.cedulascanner

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.pdf417.PDF417Writer
import com.google.zxing.pdf417.encoder.Compaction
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.zip.CRC32
import java.util.zip.DeflaterOutputStream
import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.*
import org.junit.Test

class Pdf417DecoderTest {
  private fun raw(header: Int = 0): String {
    val bytes = ByteArray(531); bytes[0] = header.toByte(); bytes[1] = header.toByte()
    fun put(start: Int, value: String) { value.toByteArray(Charsets.ISO_8859_1).copyInto(bytes, start) }
    put(2, "98765432"); put(20, "PubDSK_"); put(40, "654321"); put(48, "1234567890")
    put(58, "MUÑOZ"); put(81, "PÉREZ"); put(104, "ANA"); put(127, "MARÍA")
    put(151, "F1991072931019"); put(166, "O+")
    return String(bytes, Charsets.ISO_8859_1)
  }
  private fun encoded(text: String = raw(), black: Int = 0, white: Int = 255): Pdf417Image {
    val matrix = PDF417Writer().encode(text, BarcodeFormat.PDF_417, 1000, 440, mapOf(
      EncodeHintType.PDF417_COMPACTION to Compaction.BYTE,
      EncodeHintType.CHARACTER_SET to "ISO-8859-1", EncodeHintType.ERROR_CORRECTION to 4, EncodeHintType.MARGIN to 32))
    return Pdf417Image(ByteArray(matrix.width * matrix.height) { i ->
      (if (matrix[i % matrix.width, i / matrix.width]) black else white).toByte()
    }, matrix.width, matrix.height)
  }
  @Test fun decodesRealPdf417PixelsAndPreservesAllBinaryBytes() {
    for (header in listOf(0, 9, 32, 160)) assertEquals(raw(header), Pdf417Decoder.decode(encoded(raw(header))))
  }
  @Test fun decodesEveryQuarterTurn() {
    var image = encoded()
    repeat(4) { assertEquals(raw(), Pdf417Decoder.decode(image)); image = image.rotated() }
  }
  @Test fun decodesCompactPayloadWithNullSeparatedNames() {
    val text = listOf("  98765432", "PubDSK_", "65432100001234567890MUÑOZ", "PÉREZ", "ANA", "MARÍA", "0F19910729310190O+").joinToString("\u0000")
    assertEquals(text, Pdf417Decoder.decode(encoded(text)))
  }
  @Test fun adaptiveThresholdReadsDimLowContrastBarcode() {
    assertEquals(raw(), Pdf417Decoder.decode(encoded(black = 75, white = 125)))
  }
  @Test fun invertedBarcodeIsDetected() {
    assertEquals(raw(), Pdf417Decoder.decode(encoded(black = 245, white = 15)))
  }
  @Test fun slightlyInclinedBarcodeIsDetected() {
    val image = encoded(); val angle = 7 * Math.PI / 180
    val w = image.width + 180; val h = image.height + 180
    val pixels = ByteArray(w * h) { 255.toByte() }
    for (y in 0 until h) for (x in 0 until w) {
      val dx = x - w / 2.0; val dy = y - h / 2.0
      val sx = (dx * cos(angle) + dy * sin(angle) + image.width / 2).toInt()
      val sy = (-dx * sin(angle) + dy * cos(angle) + image.height / 2).toInt()
      if (sx in 0 until image.width && sy in 0 until image.height) pixels[y * w + x] = image.pixels[sy * image.width + sx]
    }
    assertEquals(raw(), Pdf417Decoder.decode(Pdf417Image(pixels, w, h)))
  }
  @Test fun blankImageCannotProduceIdentity() {
    assertNull(Pdf417Decoder.decode(Pdf417Image(ByteArray(400 * 200) { 255.toByte() }, 400, 200)))
  }
  @Test fun randomNoiseCannotProduceIdentity() {
    val bytes = ByteArray(400 * 200); java.util.Random(42).nextBytes(bytes)
    assertNull(Pdf417Decoder.decode(Pdf417Image(bytes, 400, 200)))
  }
  @Test fun copiesLumaWithBufferOffsetPaddingAndPixelStride() {
    val bytes = ByteBuffer.allocate(18); bytes.position(3)
    for (i in 0 until 6) bytes.put(3 + (i / 3) * 8 + (i % 3) * 2, (i + 1).toByte())
    val image = Pdf417Image.fromPlane(bytes, 3, 2, 8, 2)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6), image.pixels); assertEquals(3, bytes.position())
  }
  @Test fun decoderOwnsItsCopyBeforeCameraFrameIsClosed() {
    val bytes = ByteBuffer.wrap(byteArrayOf(1, 2, 3, 4))
    val image = Pdf417Image.fromPlane(bytes, 2, 2, 2, 1); bytes.put(0, 99)
    assertEquals(1, image.pixels[0].toInt())
  }
  @Test fun photoArgbConversionKeepsLuminanceAndGeometry() {
    val image = Pdf417Image.fromArgb(intArrayOf(0xff000000.toInt(), 0xffffffff.toInt(), 0xffff0000.toInt(), 0xff00ff00.toInt()), 2, 2)
    assertEquals(listOf(0, 255, 76, 150), image.pixels.map { it.toInt() and 255 })
  }
  @Test fun exportsSyntheticBarcodeForARepeatablePhoneCheck() {
    val image = encoded(); val decoded = Pdf417Decoder.decode(image)!!; assertEquals(raw(), decoded)
    val out = File("build/test-pdf417"); out.mkdirs()
    val png = ByteArrayOutputStream(); val output = DataOutputStream(png)
    output.write(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10))
    fun chunk(type: String, data: ByteArray) {
      val name = type.toByteArray(Charsets.US_ASCII); val crc = CRC32(); crc.update(name); crc.update(data)
      output.writeInt(data.size); output.write(name); output.write(data); output.writeInt(crc.value.toInt())
    }
    val header = ByteArrayOutputStream(); val fields = DataOutputStream(header)
    fields.writeInt(image.width); fields.writeInt(image.height); fields.write(byteArrayOf(8, 0, 0, 0, 0))
    chunk("IHDR", header.toByteArray())
    val compressed = ByteArrayOutputStream()
    DeflaterOutputStream(compressed).use { zip -> for (y in 0 until image.height) { zip.write(0); zip.write(image.pixels, y * image.width, image.width) } }
    chunk("IDAT", compressed.toByteArray()); chunk("IEND", byteArrayOf())
    File(out, "PDF417-PRUEBA-SINTETICA.png").writeBytes(png.toByteArray())
    File(out, "payload-base64.txt").writeText(java.util.Base64.getEncoder().encodeToString(raw().toByteArray(Charsets.ISO_8859_1)))
    File(out, "decoded-base64.txt").writeText(java.util.Base64.getEncoder().encodeToString(decoded.toByteArray(Charsets.ISO_8859_1)))
  }
}
