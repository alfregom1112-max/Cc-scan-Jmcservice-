package expo.modules.cedulascanner

import kotlin.math.roundToInt
import kotlin.math.tan
import org.junit.Assert.*
import org.junit.Test

class MrzLineLocatorTest {
  private val lines=listOf("ICCOL1234567897<<<<<<<<<<<<<<<", "9001011F3012316COL1234567890<1", "PEREZ<GOMEZ<<LILI<ANA<<<<<<<<<")
  private fun row(text:String, y:Int, x:Int=30, height:Int=20, angle:Float=0f) =
    MrzLineLocator.Fragment(text,x,y,x+text.length*12,y+height,angle)
  private fun full()=lines.mapIndexed { index,line -> row(line,index*32+100) }

  @Test fun completeRowsAreDetectedRegardlessOfOcrBlockOrder() {
    assertEquals(lines,MrzLineLocator.locate(full().reversed())!!.lines)
  }
  @Test fun fragmentsAreJoinedOnlyAlongTheirPhysicalRow() {
    val fragmented=lines.flatMapIndexed { i,line -> listOf(row(line.take(12),i*32+100),row(line.drop(12),i*32+100,174)) }
    assertEquals(lines,MrzLineLocator.locate(fragmented.reversed())!!.lines)
  }
  @Test fun smallFillerFragmentsCannotBlockOtherwiseCompleteText() {
    val fragmented=lines.flatMapIndexed { i,line -> listOf(row(line.take(20),i*32+100),row(line.drop(20),i*32+108,270,4)) }
    assertEquals(lines,MrzLineLocator.locate(fragmented)!!.lines)
  }
  @Test fun aNearbyLabelCannotCorruptAnAlreadyCompleteMrzLine() {
    assertEquals(lines,MrzLineLocator.locate(full()+row("CODIGO",100,450))!!.lines)
  }
  @Test fun backgroundTextBetweenRowsIsIgnoredWhenNotAligned() {
    assertEquals(lines,MrzLineLocator.locate(full()+row("ETIQUETA",124,600))!!.lines)
  }
  @Test fun nearbyLabelsCannotCorruptFragmentedMrzRows() {
    val fragments=lines.flatMapIndexed { i,line -> listOf(row(line.take(12),i*32+100),row(line.drop(12),i*32+100,174),row("CODIGO",i*32+100,450)) }
    assertEquals(lines,MrzLineLocator.locate(fragments)!!.lines)
  }
  @Test fun shortTextLabelsInsideTheRegionCannotReplaceTheSecondRow() {
    assertEquals(lines,MrzLineLocator.locate(full()+row("NUIP",124,30))!!.lines)
  }
  @Test fun whitespaceAndPrintedFillerVariantsDoNotHideThePrefix() {
    val decorated=full().map { it.copy(text=it.text.replace("<","«").chunked(5).joinToString(" ")) }
    assertEquals(lines,MrzLineLocator.locate(decorated)!!.lines)
  }
  @Test fun tiltedFragmentsUseTheirProjectedBaseline() {
    val angle=8f
    val fragments=lines.flatMapIndexed { i,line -> listOf(0,15).map { at ->
      val x=30+at*12
      val y=100+i*32+(tan(angle*Math.PI/180)*(x+90)).roundToInt()
      row(line.substring(at,at+15),y,x,20,angle)
    } }
    assertEquals(lines,MrzLineLocator.locate(fragments)!!.lines)
  }
  @Test fun partialLinesAreDeliveredAsCandidatesWithoutPaddingOrInventingCharacters() {
    val partial=full().mapIndexed { i,f -> if(i==1)f.copy(text=f.text.dropLast(1)) else f }
    assertEquals(lines[1].dropLast(1),MrzLineLocator.locate(partial)!!.lines[1])
  }
  @Test fun missingRowsCannotProduceACandidate() { assertNull(MrzLineLocator.locate(full().take(2))) }
  @Test fun ordinaryTextCannotProduceACandidate() { assertNull(MrzLineLocator.locate(listOf(row("REPUBLICA DE COLOMBIA",100)))) }
  @Test fun farAwayRowsCannotBeCombined() {
    assertNull(MrzLineLocator.locate(listOf(full()[0],row(lines[1],400),row(lines[2],432))))
  }
  @Test fun invalidGeometryCannotProduceACandidate() {
    assertNull(MrzLineLocator.locate(full().map { it.copy(right=it.left) }))
  }
}
