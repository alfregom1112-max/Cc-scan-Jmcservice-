package expo.modules.cedulascanner

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Geometry only: never completes, pads or invents MRZ characters. Content is validated in JS. */
object MrzLineLocator {
  data class Fragment(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int, val angle: Float = 0f)
  data class Candidate(val lines: List<String>, val fragments: List<Fragment>)
  private data class Row(val fragments: MutableList<Fragment>, val baseline: Double, val height: Double)
  private val prefix = Regex("^[I1][DC]<?C[O0][LI1].*")
  fun compact(text: String) = text.uppercase().replace(Regex("\\s"), "").replace(Regex("[«‹›>]"), "<")
  private fun spans(fragments: List<Fragment>): List<List<Fragment>> {
    val result=mutableListOf<List<Fragment>>()
    for (start in fragments.indices) {
      var length=0
      for (end in start until fragments.size) {
        length+=compact(fragments[end].text).length
        if (length>35) break
        result.add(fragments.subList(start,end+1).toList())
      }
    }
    return result
  }

  fun locate(input: List<Fragment>): Candidate? {
    val pieces = input.filter { it.right > it.left && it.bottom > it.top &&
      compact(it.text).matches(Regex("[A-Z0-9<]+")) }
    if (pieces.isEmpty()) return null
    val angles = pieces.map { it.angle }.filter { it.isFinite() && abs(it) <= 30 }.sorted()
    val angle = (angles.getOrNull(angles.size / 2) ?: 0f) * Math.PI / 180
    fun baseline(f: Fragment) = (f.top + f.bottom) / 2.0 * cos(angle) - (f.left + f.right) / 2.0 * sin(angle)
    // A tilted long line has a tall bounding box; its character height is much smaller.
    fun height(f: Fragment) = min((f.bottom-f.top).toDouble(), max(4.0, (f.right-f.left).toDouble() / compact(f.text).length * 1.8))
    val rows = mutableListOf<Row>()
    for (piece in pieces.sortedBy(::baseline)) {
      val y = baseline(piece)
      val row = rows.minByOrNull { abs(it.baseline-y) }?.takeIf {
        abs(it.baseline-y) <= max(4.0, min(it.height,height(piece))*0.65)
      }
      if (row == null) rows.add(Row(mutableListOf(piece),y,height(piece))) else row.fragments.add(piece)
    }
    val ordered = rows.sortedBy { it.baseline }
    val candidates = mutableListOf<Candidate>()
    for (row in ordered) {
      val fragments = row.fragments.sortedBy { it.left }
      // Try individual OCR lines as well as joined fragments. Nearby labels must not corrupt a complete line.
      val starts = spans(fragments).filter {
        prefix.matches(it.joinToString("") { f -> compact(f.text) })
      }
      for (start in starts) {
        val left = start.minOf { it.left }; val right = start.maxOf { it.right }; val width = right-left
        val below = ordered.filter { it.baseline > row.baseline + max(4.0,row.height*0.65) }
          .mapNotNull { next ->
            val aligned = next.fragments.filter { f -> f.left >= left-width*0.15 && f.right <= right+width*0.15 }.sortedBy { it.left }
            val alternatives = spans(aligned)
            val best = alternatives.minByOrNull { abs(it.sumOf { f -> compact(f.text).length }-30) } ?: return@mapNotNull null
            if (abs(best.sumOf { compact(it.text).length }-30) > 5) null else next to best
          }.take(2)
        if (below.size != 2) continue
        // Keep neighboring rows of the same MRZ; do not bridge unrelated document regions.
        if (below.last().first.baseline-row.baseline > max(row.height*8,80.0)) continue
        val selected = listOf(start) + below.map { it.second }
        candidates.add(Candidate(selected.map { it.joinToString("") { f -> compact(f.text) } }, selected.flatten()))
      }
    }
    val unique = candidates.distinctBy { it.lines }
    val complete = unique.filter { it.lines.all { line -> line.length == 30 } }
    if (complete.size > 1) return null
    return complete.singleOrNull() ?: unique.minByOrNull { it.lines.sumOf { line -> abs(line.length-30) } }
  }
}
