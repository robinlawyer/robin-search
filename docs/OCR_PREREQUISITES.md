# PDFs escaneados — requisito previo de OCR (v1.0)

RobinSearch v1.0 indexa PDFs **con texto extraíble** y DOCX. Un PDF que es una **imagen
escaneada** (acta notarial, sentencia en papel escaneada, etc.) no tiene capa de texto y **no
puede indexarse** hasta pasarlo por OCR. El OCR integrado llega en **v1.1**.

## Cómo lo detecta RobinSearch

Al indexar, si un PDF apenas contiene texto extraíble se marca como *sin OCR*, se **omite del
índice** (no falla en silencio) y aparece en:

- `estado_servidor()` → campo `ficheros_sin_ocr`
- `listar_documentos_indexados()` → `sin_ocr: true`

## Cómo pre-procesar (mientras llega el OCR nativo)

- **Adobe Acrobat Pro:** Herramientas → *Digitalizar y OCR* → *Reconocer texto*.
- **Google Drive:** subir el PDF, *Abrir con Documentos de Google* (aplica OCR) y exportar a PDF.
- **ABBYY FineReader:** OCR por lotes para volúmenes grandes.

Guarda el PDF resultante (ya con capa de texto) en la carpeta de expedientes: el watcher lo
detecta y lo indexa automáticamente.
