package expo.modules.cedulascanner

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Size
import android.view.MotionEvent
import android.view.ViewGroup
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

/** One camera owner. All automatic frames remain in memory; only explicit capture writes a temporary file. */
class CedulaScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  private val onObservation by EventDispatcher()
  private val onStatus by EventDispatcher()
  private val onBarcode by EventDispatcher()
  private val onError by EventDispatcher()
  private val preview = PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE }
  private val executor = Executors.newSingleThreadExecutor()
  private val pdfExecutor = Executors.newSingleThreadExecutor()
  private val pdfBusy = AtomicBoolean(false)
  private val photoBusy = AtomicBoolean(false)
  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var cancelPhoto: (() -> Unit)? = null
  private var lastPdfAttempt = -1000L
  private val busy = AtomicBoolean(false)
  private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
  private val barcodeReader = BarcodeScanning.getClient(BarcodeScannerOptions.Builder()
    .setBarcodeFormats(Barcode.FORMAT_PDF417, Barcode.FORMAT_QR_CODE).build())
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var analysis: ImageAnalysis? = null
  private var captureUseCase: ImageCapture? = null
  private var previewUseCase: Preview? = null
  @Volatile private var active = true
  @Volatile private var generation = 0
  @Volatile private var session = 0
  private var torch = false
  private val performance = ScanPerformance()
  private val resourcesClosed = AtomicBoolean(false)
  private var lastStatus = ""
  private var statusAt = 0L
  @Volatile private var attached = false
  @Volatile private var released = false

  init {
    addView(preview, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    preview.setOnTouchListener { _, event ->
      if (event.action == MotionEvent.ACTION_UP) {
        val point = preview.meteringPointFactory.createPoint(event.x, event.y)
        camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(point)
          .setAutoCancelDuration(3, TimeUnit.SECONDS).build())
      }
      true
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    preview.layout(0, 0, right - left, bottom - top)
  }

  fun setActive(value: Boolean) {
    if (active != value) { active = value; generation++; status("searching", "Presenta el reverso de la cédula") }
    if (value && attached && camera == null) startCamera()
  }

  fun setTorch(value: Boolean) { torch = value; camera?.cameraControl?.enableTorch(value) }

  fun setSession(value: Int) {
    if (session != value) { session = value; generation++ }
    if (active && attached && camera == null) startCamera()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    if (active) startCamera()
  }

  override fun onDetachedFromWindow() {
    attached = false
    generation++
    analysis?.clearAnalyzer()
    val cases = listOfNotNull(previewUseCase, analysis, captureUseCase)
    if (cases.isNotEmpty()) provider?.unbind(*cases.toTypedArray())
    camera = null
    super.onDetachedFromWindow()
  }

  fun release() {
    if (released) return
    released = true
    cancelPhoto?.invoke()
    pdfExecutor.shutdown()
    active = false
    generation++
    analysis?.clearAnalyzer()
    val cases = listOfNotNull(previewUseCase, analysis, captureUseCase)
    if (cases.isNotEmpty()) provider?.unbind(*cases.toTypedArray())
    camera = null
    // Let both current ML Kit readers release the camera buffer before closing their clients.
    executor.execute { if (!busy.get()) closeResources() }
  }

  private fun status(code: String, message: String) {
    val now = SystemClock.elapsedRealtime()
    if (code == lastStatus && now - statusAt < 800) return
    lastStatus = code; statusAt = now
    onStatus(mapOf("code" to code, "message" to message, "generation" to generation, "session" to session))
  }

  private fun startCamera() {
    if (released || !attached || camera != null) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      onError(mapOf("message" to "Falta permiso de cámara", "session" to session)); return
    }
    val ticket = generation
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (!attached || !active || released || ticket != generation || camera != null) return@addListener
      try {
        val owner = appContext.currentActivity as? LifecycleOwner ?: error("No hay actividad de cámara")
        val p = future.get(); provider = p
        val resolution = ResolutionSelector.Builder().setResolutionStrategy(
          ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()
        val displayRotation = display?.rotation ?: 0
        val live = Preview.Builder().setTargetRotation(displayRotation).build().also { it.setSurfaceProvider(preview.surfaceProvider) }
        val frames = ImageAnalysis.Builder().setTargetRotation(displayRotation).setResolutionSelector(resolution)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        val photo = ImageCapture.Builder().setTargetRotation(displayRotation)
          .setResolutionSelector(resolution)
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
        frames.setAnalyzer(executor) { analyze(it) }
        previewUseCase = live; analysis = frames; captureUseCase = photo
        camera = p.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, live, frames, photo)
        setTorch(torch)
        status("searching", "Presenta el reverso de la cédula")
      } catch (e: Exception) { onError(mapOf("message" to (e.message ?: "No se pudo iniciar la cámara"), "session" to session)) }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun closeResources() {
    if (!resourcesClosed.compareAndSet(false,true)) return
    recognizer.close(); barcodeReader.close(); executor.shutdown()
  }

  private fun queuePdf417(frame: ImageProxy, ticket: Int, sessionTicket: Int, frameId: Long) {
    val started = SystemClock.elapsedRealtime()
    if (photoBusy.get() || started - lastPdfAttempt < 750 || !pdfBusy.compareAndSet(false, true)) return
    lastPdfAttempt = started
    try {
      val plane = frame.planes[0]
      val image = Pdf417Image.fromPlane(plane.buffer, frame.width, frame.height, plane.rowStride, plane.pixelStride)
      pdfExecutor.execute {
        try {
          if (!active || !attached || released || generation != ticket || session != sessionTicket) return@execute
          val raw = Pdf417Decoder.decode(image)
          performance.record("pdf417FallbackMs", (SystemClock.elapsedRealtime() - started).toDouble())
          if (!raw.isNullOrEmpty() && active && attached && !released && generation == ticket && session == sessionTicket && !photoBusy.get()) {
            performance.record("pdf417FallbackDetected", 1.0)
            onBarcode(mapOf("raw" to raw, "type" to "pdf417", "engine" to "zxing",
              "frameId" to frameId.toDouble(), "session" to sessionTicket))
          }
        } catch (_: Exception) { performance.record("pdf417FallbackErrors", 1.0) }
        finally { pdfBusy.set(false) }
      }
    } catch (_: Exception) { pdfBusy.set(false); performance.record("pdf417FallbackErrors", 1.0) }
  }

  fun getPerformance() = performance.snapshot()
  fun resetPerformance() = performance.reset()
  fun recordConfirmation(firstFrameId: Double) {
    val now=SystemClock.elapsedRealtime().toDouble()
    if (firstFrameId.isFinite() && firstFrameId > 0 && firstFrameId <= now)
      performance.record("mrzConfirmationMs",now-firstFrameId)
  }

  @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
  private fun analyze(frame: ImageProxy) {
    if (!active || !attached || released || !busy.compareAndSet(false,true)) { frame.close(); return }
    val now=SystemClock.elapsedRealtime()
    performance.record("imageWidth", frame.width.toDouble())
    performance.record("imageHeight", frame.height.toDouble())
    val ticket=generation
    val sessionTicket=session
    val lease=FrameLease {
      try { frame.close() } finally {
        performance.record("frameProcessingMs",(SystemClock.elapsedRealtime()-now).toDouble())
        busy.set(false)
        if (released) closeResources()
      }
    }
    fun current()=active && attached && !released && generation==ticket && session==sessionTicket
    try {
      val media=frame.image ?: return
      val input=InputImage.fromMediaImage(media,frame.imageInfo.rotationDegrees)
      // Both readers see the same native buffer. Neither waits for the other to report a result.
      lease.retain()
      try {
        barcodeReader.process(input).addOnCompleteListener(executor) { task ->
          try {
            val elapsed=(SystemClock.elapsedRealtime()-now).toDouble()
            performance.record("barcodeProcessingMs",elapsed)
            if (task.isSuccessful && current()) {
              val codes=task.result
              if (codes.isNotEmpty()) performance.record("barcodeDetectedMs",elapsed)
              for (code in codes) {
                val bytes = code.rawBytes
                val raw=if (code.format==Barcode.FORMAT_PDF417 && bytes != null && bytes.isNotEmpty())
                  String(bytes,Charsets.ISO_8859_1) else code.rawValue.orEmpty()
                if (raw.isNotEmpty()) onBarcode(mapOf("raw" to raw,
                  "type" to if (code.format==Barcode.FORMAT_PDF417) "pdf417" else "qr",
                  "frameId" to now.toDouble(),"session" to sessionTicket,"elapsedMs" to elapsed))
              }
            }
            if (current() && (!task.isSuccessful || task.result.none { it.format == Barcode.FORMAT_PDF417 }))
              queuePdf417(frame, ticket, sessionTicket, now)
          } finally { lease.release() }
        }
      } catch (_: Exception) { lease.release() }
      lease.retain()
      try {
        recognizer.process(input).addOnCompleteListener(executor) { task ->
          try {
            performance.record("ocrProcessingMs",(SystemClock.elapsedRealtime()-now).toDouble())
            if (task.isSuccessful && current()) observe(task.result,frame,now,sessionTicket)
            else if (current()) {
              performance.record("ocrErrors",1.0)
              status("ocr_error","El lector de texto no respondió; pulsa Reiniciar cámara")
            }
          } catch (_: Exception) {
            if (current()) status("retry","Mantén la cédula quieta para volver a leer")
          } finally { lease.release() }
        }
      } catch (_: Exception) {
        performance.record("ocrErrors",1.0)
        if (current()) status("ocr_error","No se pudo iniciar el lector de texto; pulsa Reiniciar cámara")
        lease.release()
      }
    } catch (_: Exception) {
      if (current()) status("retry","No pude analizar este cuadro; vuelve a alinear la cédula")
    } finally { lease.release() }
  }

  private fun observe(text: Text, frame: ImageProxy, frameId: Long, sessionTicket: Int) {
    val fragments = text.textBlocks.flatMap { it.lines }.mapNotNull { line ->
      line.boundingBox?.let { MrzLineLocator.Fragment(line.text,it.left,it.top,it.right,it.bottom,line.angle) }
    }
    performance.record("ocrLines",fragments.size.toDouble())
    val candidate = MrzLineLocator.locate(fragments)
    if (candidate == null) {
      status("searching", if (fragments.isEmpty()) "Buscando texto: acerca el reverso y toca para enfocar"
        else "Texto detectado: centra las tres líneas del reverso")
      return
    }
    // Image heuristics are guidance, not evidence that decoded text is invalid.
    // Always deliver candidates to the checksum validator, even if quality estimation fails.
    var guidance: String? = null
    try {
      val boxes=candidate.fragments
      val roi=Rect(boxes.minOf { it.left },boxes.minOf { it.top },boxes.maxOf { it.right },boxes.maxOf { it.bottom })
      val plane=frame.planes[0]
      val luma=UprightLuma(plane.buffer,frame.width,frame.height,plane.rowStride,plane.pixelStride,frame.imageInfo.rotationDegrees)
      val inBounds=roi.left>2 && roi.top>2 && roi.right<luma.width-2 && roi.bottom<luma.height-2
      if (inBounds) {
        val qualityStart=SystemClock.elapsedRealtimeNanos()
        val quality=luma.quality(roi.left,roi.top,roi.right,roi.bottom)
        performance.record("qualityMs",(SystemClock.elapsedRealtimeNanos()-qualityStart)/1_000_000.0)
        guidance=ReadingQuality.message(true,boxes.maxOf { it.bottom-it.top },boxes.maxOf { abs(it.angle) },quality[0],quality[1],quality[2])
      } else guidance="Centra las tres líneas dentro de la cámara"
    } catch (_: Exception) { /* Geometry/quality failures must not silence a decoded MRZ. */ }
    performance.record("mrzDetectedMs",(SystemClock.elapsedRealtime()-frameId).toDouble())
    status("reading", "Leyendo y comprobando los datos…")
    onObservation(mapOf("raw" to candidate.lines.joinToString("\n"), "guidance" to guidance.orEmpty(), "frameId" to frameId.toDouble(),
      "generation" to generation, "session" to sessionTicket, "elapsedMs" to (SystemClock.elapsedRealtime() - frameId).toDouble()))
  }

  fun capture(promise: Promise) {
    val photo = captureUseCase
    if (photo == null || !attached) { promise.reject("CAMERA_UNAVAILABLE", "La cámara no está lista", null); return }
    val file = File.createTempFile("cedula-manual-", ".jpg", context.cacheDir)
    photo.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context),
      object : ImageCapture.OnImageSavedCallback {
        override fun onImageSaved(result: ImageCapture.OutputFileResults) {
          try { promise.resolve(Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)) }
          catch (e: Exception) { promise.reject("CAPTURE_FAILED", e.message, e) }
          finally { file.delete() }
        }
        override fun onError(error: ImageCaptureException) { file.delete(); promise.reject("CAPTURE_FAILED", error.message, error) }
      })
  }

  /** Explicit PDF417 still-image read; temporary photo stays on-device and is deleted. */
  fun readPdf417(promise: Promise) {
    val photo = captureUseCase
    if (photo == null || !attached || released) { promise.reject("CAMERA_UNAVAILABLE", "La cámara no está lista", null); return }
    if (!photoBusy.compareAndSet(false, true)) { promise.reject("CAPTURE_BUSY", "Ya se está leyendo el PDF417", null); return }
    val ticket = generation; val sessionTicket = session
    val file = try { File.createTempFile("pdf417-local-", ".jpg", context.cacheDir) }
      catch (e: Exception) { photoBusy.set(false); promise.reject("CAPTURE_FAILED", e.message, e); return }
    val finished = AtomicBoolean(false)
    lateinit var timeout: Runnable
    fun finish(raw: String? = null, error: Exception? = null) {
      if (!finished.compareAndSet(false, true)) return
      mainHandler.removeCallbacks(timeout); cancelPhoto = null; photoBusy.set(false); file.delete()
      if (error != null) promise.reject("PDF417_READ_FAILED", error.message, error)
      else promise.resolve(mapOf("raw" to raw.orEmpty(), "type" to "pdf417", "engine" to "zxing"))
    }
    timeout = Runnable { finish(error = IllegalStateException("La captura PDF417 no respondió. Vuelve a intentarlo.")) }
    cancelPhoto = { finish(error = IllegalStateException("La cámara se cerró antes de terminar la lectura")) }
    mainHandler.postDelayed(timeout, 12_000)
    try {
      photo.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context),
        object : ImageCapture.OnImageSavedCallback {
          override fun onImageSaved(result: ImageCapture.OutputFileResults) {
            try {
              pdfExecutor.execute {
                try {
                  check(!released && attached && generation == ticket && session == sessionTicket) { "La sesión de cámara cambió" }
                  val bitmap = BitmapFactory.decodeFile(file.absolutePath) ?: error("No se pudo abrir la captura")
                  val raw = try {
                    val pixels = IntArray(bitmap.width * bitmap.height)
                    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                    Pdf417Decoder.decode(Pdf417Image.fromArgb(pixels, bitmap.width, bitmap.height))
                  } finally { bitmap.recycle() }
                  check(!released && attached && generation == ticket && session == sessionTicket) { "La sesión de cámara cambió" }
                  finish(raw)
                } catch (e: Exception) { finish(error = e) }
              }
            } catch (e: Exception) { finish(error = e) }
          }
          override fun onError(error: ImageCaptureException) { finish(error = error) }
        })
    } catch (e: Exception) { finish(error = e) }
  }
}
