// Los candidatos que se miden, y cómo se traduce lo que dice cada uno.
//
// Todos corren con @xenova/transformers, la MISMA librería que ya usa la búsqueda: soporta
// clasificación de tokens además de los embeddings, así que no entra dependencia nueva en el
// package.json. Lo que entra es el PESO de un modelo más dentro del .mcpb, y eso es justo lo que
// aquí se mide, porque se lo descarga el abogado en cada actualización.
//
// Referencia de peso: hoy el .mcpb son 243 MB, de los que 113 MB son el e5-small cuantizado de la
// búsqueda y 16 MB su tokenizador.
//
// `personas` traduce las etiquetas de cada modelo a lo que a nosotros nos interesa:
//   'PERSONA'  → se convierte en alias
//   'OTRO'     → se mide aparte, NO se tapa por defecto (ORG y LOC son la fuente principal de
//                sobre-tapado: el reconocedor marca «Juzgado» como organización y «Madrid» como
//                lugar, y taparlos deja el escrito inservible)
//   null       → se ignora

export const CANDIDATOS = [
  {
    id: 'distilbert-multi-hrl',
    modelo: 'Xenova/distilbert-base-multilingual-cased-ner-hrl',
    nota: 'DistilBERT multilingüe destilado, 10 idiomas de alto recurso, español incluido. El ligero.',
    pesoMB: 135.4 + 9.1, // model_quantized.onnx + tokenizer.json
    etiqueta: (e) => {
      const t = e.replace(/^[BI]-/, '');
      if (t === 'PER') return 'PERSONA';
      if (t === 'ORG' || t === 'LOC') return 'OTRO';
      return null;
    },
  },
  {
    id: 'bert-base-multi-hrl',
    modelo: 'Xenova/bert-base-multilingual-cased-ner-hrl',
    nota: 'mBERT base, mismo entrenamiento que el anterior sin destilar. El que Alonso teme por peso.',
    pesoMB: 178.5 + 17.1,
    etiqueta: (e) => {
      const t = e.replace(/^[BI]-/, '');
      if (t === 'PER') return 'PERSONA';
      if (t === 'ORG' || t === 'LOC') return 'OTRO';
      return null;
    },
  },
  {
    id: 'bert-small-pii',
    modelo: 'onnx-community/bert-small-pii-detection-ONNX',
    nota: 'BERT pequeño entrenado directamente en PII, no en NER genérico. El mini.',
    pesoMB: 28.7 + 2.0,
    etiqueta: (e) => {
      const t = e.replace(/^[BI]-/, '').toUpperCase();
      if (/NAME|PERSON|SURNAME|GIVENNAME|LASTNAME/.test(t)) return 'PERSONA';
      if (t === 'O' || t === 'LABEL_0') return null;
      return 'OTRO';
    },
  },
  {
    id: 'multilang-pii-ner',
    modelo: 'onnx-community/multilang-pii-ner-ONNX',
    nota: 'PII multilingüe de tamaño grande. El techo de acierto, y el techo de peso.',
    pesoMB: 278.7 + 17.1,
    etiqueta: (e) => {
      const t = e.replace(/^[BI]-/, '').toUpperCase();
      if (/NAME|PERSON|SURNAME|GIVENNAME|LASTNAME/.test(t)) return 'PERSONA';
      if (t === 'O' || t === 'LABEL_0') return null;
      return 'OTRO';
    },
  },
];

export default CANDIDATOS;
