package expo.modules.cedulascanner

import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.pdf417.PDF417Reader
import java.nio.ByteBuffer
import kotlin.math.*

/** An owned luminance image: decoding never keeps a CameraX buffer alive. */
class Pdf417Image(val pixels: ByteArray, val width: Int, val height: Int) {
  init { require(width > 0 && height > 0 && pixels.size == width * height) }
  fun rotated(): Pdf417Image {
    val out = ByteArray(pixels.size)
    for (y in 0 until height) for (x in 0 until width) out[(width - 1 - x) * height + y] = pixels[y * width + x]
    return Pdf417Image(out, height, width)
  }
  fun estimatedTilt(): Double {
    var xx = 0.0; var yy = 0.0; var xy = 0.0
    val step = max(2, width / 500)
    fun at(x: Int, y: Int) = pixels[y * width + x].toInt() and 255
    for (y in 1 until height - 1 step step) for (x in 1 + y % step until width - 1 step step) {
      val gx = at(x + 1, y) - at(x - 1, y); val gy = at(x, y + 1) - at(x, y - 1)
      if (gx * gx + gy * gy < 400) continue
      xx += gx.toDouble() * gx; yy += gy.toDouble() * gy; xy += gx.toDouble() * gy
    }
    val total = xx + yy
    if (total == 0.0 || hypot(xx - yy, 2 * xy) / total < 0.08) return 0.0
    var angle = atan2(2 * xy, xx - yy) * 90 / Math.PI
    if (angle > 45) angle -= 90 else if (angle < -45) angle += 90
    return angle
  }
  fun rotatedBy(degrees: Double): Pdf417Image {
    val angle = degrees * Math.PI / 180; val c = cos(angle); val s = sin(angle)
    val w = ceil(abs(width * c) + abs(height * s)).toInt()
    val h = ceil(abs(height * c) + abs(width * s)).toInt()
    val out = ByteArray(w * h) { 255.toByte() }
    fun at(x: Int, y: Int) = pixels[y * width + x].toInt() and 255
    for (y in 0 until h) for (x in 0 until w) {
      val dx = x - w / 2.0; val dy = y - h / 2.0
      val sx = dx * c + dy * s + width / 2.0; val sy = -dx * s + dy * c + height / 2.0
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) continue
      val ix = sx.toInt(); val iy = sy.toInt(); val fx = sx - ix; val fy = sy - iy
      val top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx
      val bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx
      out[y * w + x] = (top * (1 - fy) + bottom * fy).roundToInt().toByte()
    }
    return Pdf417Image(out, w, h)
  }
  companion object {
    fun fromPlane(buffer: ByteBuffer, width: Int, height: Int, rowStride: Int, pixelStride: Int): Pdf417Image {
      require(width > 0 && height > 0 && pixelStride > 0 && rowStride >= (width - 1) * pixelStride + 1)
      val source = buffer.duplicate(); val base = source.position()
      require(base + (height - 1) * rowStride + (width - 1) * pixelStride < source.limit())
      val out = ByteArray(width * height)
      for (y in 0 until height) {
        if (pixelStride == 1) { source.position(base + y * rowStride); source.get(out, y * width, width) }
        else for (x in 0 until width) out[y * width + x] = source.get(base + y * rowStride + x * pixelStride)
      }
      return Pdf417Image(out, width, height)
    }
    fun fromArgb(pixels: IntArray, width: Int, height: Int): Pdf417Image {
      require(pixels.size == width * height)
      return Pdf417Image(ByteArray(pixels.size) { i ->
        val rgb = pixels[i]
        ((((rgb shr 16 and 255) * 306) + ((rgb shr 8 and 255) * 601) + ((rgb and 255) * 117) + 512) shr 10).toByte()
      }, width, height)
    }
  }
}

object Pdf417Decoder {
  private class Source(val image: Pdf417Image) : LuminanceSource(image.width, image.height) {
    override fun getMatrix() = image.pixels
    override fun getRow(y: Int, row: ByteArray?): ByteArray {
      require(y in 0 until height)
      val out = row?.takeIf { it.size >= width } ?: ByteArray(width)
      image.pixels.copyInto(out, 0, y * width, (y + 1) * width)
      return out
    }
  }
  fun decode(image: Pdf417Image): String? {
    read(image)?.let { return it }
    val tilt = image.estimatedTilt()
    if (abs(tilt) in 1.0..20.0) return read(image.rotatedBy(-tilt))
    return null
  }
  private fun read(image: Pdf417Image): String? {
    val hints = mapOf(DecodeHintType.TRY_HARDER to true, DecodeHintType.CHARACTER_SET to "ISO-8859-1")
    var current = image
    // PDF417's detector handles 0/180 internally; the second orientation covers 90/270.
    repeat(2) {
      val source = Source(current)
      for (variant in listOf<LuminanceSource>(source, source.invert())) {
        try {
          val result = PDF417Reader().decode(BinaryBitmap(HybridBinarizer(variant)), hints)
          // PDF417Reader.text already contains byte-compacted Latin-1 data, including NULs.
          if (result.text.isNotEmpty()) return result.text
        } catch (_: ReaderException) { /* An undecodable image is not an identity. */ }
      }
      current = current.rotated()
    }
    return null
  }
}
