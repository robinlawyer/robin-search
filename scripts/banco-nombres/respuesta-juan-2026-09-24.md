Asunto: Re: Anonimizador local en RobinSearch — viabilidad y cuatro decisiones que quiero contigo

Juan,

Gracias por mirarte el 0049/2023 entero y por lo del 9.2.f. Con los cuatro puntos cerrados me puse
con el banco de nombres, y como el banco solo servía para elegir modelo he acabado construyendo
también el anonimizador y midiéndolo. Menos mal, porque lo que ha salido cambia la decisión de
arriba abajo: **el modelo casi no hace falta**.

**Lo que hay.** El filtro entero, con sus capas, y 68 fragmentos anotados a mano —demandas,
escrituras, sentencias, diligencias del LAJ, atestados, periciales, nóminas, laudos, correos y
escaneos en MAYÚSCULAS SIN TILDES— repartidos en dos corpus: uno de trabajo, contra el que he
afinado las reglas, y otro de validación escrito aparte, con otras jurisdicciones y nombres
catalanes, vascos, gallegos y extranjeros, para tener un número que no sea el de mi propio examen.

**El resultado, sobre el corpus de validación:**

```
configuración             peso   instalador   60 frag.    tapa   en escaneo   escapan   sobre-tapa
solo reglas               0 MB      243 MB          —   97,8 %      100 %           2       0,0 %
distilbert-multi-hrl    145 MB      388 MB      17,1 s   98,9 %      100 %           1       1,7 %
bert-base-multi-hrl     196 MB      439 MB      41,1 s   98,9 %      100 %           1       0,0 %
bert-small-pii           31 MB      274 MB       6,7 s   98,9 %      100 %           1       0,0 %
multilang-pii-ner       296 MB      539 MB      47,2 s   97,8 %      100 %           2       0,0 %
```

Mira la primera fila. **Sin modelo ninguno, con reglas y nada más, se tapa el 97,8 %**, y el 99,4 %
en el corpus de trabajo. El mejor modelo sube eso al 98,9 %, y en el corpus de trabajo lo deja en el
100 % sin un solo escape; pero mira lo que cuesta ese salto: de los 90 datos tapados en la
validación, el modelo pone **uno**. Todo lo demás lo hacen cosas que no pesan ni un MB: el dígito
de control, el tratamiento y el cargo delante del nombre, la propagación de lo ya visto, la
estructura del domicilio y el vocabulario clínico.

Eso da la vuelta a la pregunta. No es «qué NER metemos», es «compensa meter alguno». Mi respuesta:
sí, pero el pequeño. `bert-small-pii` son **31 MB** y dejan el instalador en 274, cuando yo te había
dicho que un NER de tamaño base nos pondría cerca de 360. Ahí me quedé corto por los dos lados: el
base de verdad lo deja en **439**, y el que hace falta en **274**. Tarda 6,7 segundos en una
respuesta de 60 fragmentos y con él no se escapa ni un nombre en el corpus de trabajo. Los dos NER
«serios» cuestan seis veces más peso para lo mismo, y el grande no solo no mejora: empeora.

**Por qué las reglas le ganan a un modelo.** Porque un escrito judicial es un formulario. El nombre
va detrás del tratamiento o del cargo casi siempre, y eso es una regla, no una estadística: no falla
a la cuarta «D.ª» seguida y funciona igual en un escaneo en mayúsculas, donde la capitalización ya
no dice nada. El modelo hace falta para lo que aparece sin presentar —«Me llamó ayer Sonia Belmonte
Tirado»—, que existe, pero es poco.

**Y el banco destapó dos agujeros que no habíamos visto ninguno de los dos.** El primero es serio:
de los cuatro modelos que probé, **ninguno tapaba un solo dato de categoría especial**. Cero de
seis. Es lógico visto en frío —«espondilitis anquilosante» no es un nombre, y un reconocedor de
nombres no lo busca—, pero significa que la regla que tú y yo cerramos como «tapar siempre en caso
de duda» era la única que no tenía nada detrás. El segundo: los domicilios, también a cero, porque
el filtro solo convierte en alias lo que el modelo etiqueta como persona y una dirección la etiqueta
como lugar.

Los dos están tapados. La categoría especial va ahora **11 de 11** en validación, y no con un
modelo sino con vocabulario y morfología, que para esto funciona mejor: lo que protege el 9.1 es un
conjunto cerrado y se puede enumerar —salud, origen étnico, religión, afiliación sindical,
orientación sexual, genéticos—. Los sufijos clínicos (-itis, -osis, -emia, -patía) cubren muchísimo
más que cualquier lista de patologías. Y los domicilios van **4 de 4**, tratándolos como lo que
son, una estructura y no una entidad: «Madrid» a secas se queda en claro, «calle Serrano 45, 3º B, 28006 Madrid» se tapa entero. Taparlos por la vía del modelo no era
opción: de las 831 marcas de lugar y organización que pone sobre los dos corpus, **273 pisan algo
intocable**, una de cada tres. Si tapas los lugares para pillar los domicilios, te llevas por
delante «Madrid», el juzgado y media cabecera de cada escrito.

**Y el número que más me ha gustado: 96,7 %.** Es lo que el filtro taparía de la lista de
intocables **si le quitas la guardia**. Con ella, cero. O sea que la lista que discutimos tú y yo no
es un anexo del proyecto: es la mitad del producto. Sin ella, el modelo se lleva por delante los
juzgados, los ECLI, las normas y los ponentes, y la respuesta deja de servir para trabajar.

**El camino de vuelta funciona.** Anonimizar y revertir devuelve el texto original; donde no es
idéntico es porque el nombre vuelve mejor de lo que estaba —«Urdiales Cotrina» vuelve como
«Feliciana Urdiales Cotrina», y «JUAN PEREZ GOMEZ» de un anexo escaneado vuelve como «Juan Pérez
Gómez»—, que en un borrador que firma un abogado es exactamente lo que se quiere. Textos
corrompidos: **cero**. Hay 51 pruebas de invariantes y pasan las 51: el alias es estable entre
respuestas, los expedientes están aislados (un nombre conocido en un asunto no se propaga al otro,
que era el cabo que más me preocupaba), y si Claude se inventa un «[PERSONA_9]» que nunca existió
se detecta en vez de colarse en el borrador.

**Ahora la parte incómoda, que es la que de verdad justifica haber hecho esto.** Medir destapó
cinco fallos que leyendo el código no se ven, y tres habrían llegado al cliente:

1. **El filtro corrompía el texto.** Al recortar el nombre por delante, el corte no se movía con él:
   «letrada de D. Alberto Ferrer Castaño» salía como «letrada Alberto Ferrer Castañoastaño».
2. **Dos alias para la misma persona.** «Juan Pérez Gómez» arriba y «Pérez Gómez» dos párrafos más
   abajo recibían alias distintos, así que Claude razonaba sobre dos personas y redactaba sobre dos.
3. **Una «y» dejaba a una heredera en claro.** En «…D. Llorenç Sastre Vives y D.ª Margalida Sastre
   Vives» el nombre se estiraba hasta comerse el «D.» de Margalida, y Margalida no se detectaba.
4. **Una protección estirada de más destapa.** La excepción que protege «Tribunal…» llegaba al final
   de la frase y dejaba sin tapar el domicilio que venía detrás; la de «artículo…» se tragaba una
   matrícula. Contraintuitivo y peligroso: proteger de más abre agujeros.
5. **«El reclamante padece espondilitis» daba una persona llamada «padece espondilitis
   anquilosante»**, que además le robaba el trozo a la regla de categoría especial y dejaba el
   diagnóstico mal etiquetado.

**Lo que sigue sin funcionar, dicho claro.** Las perífrasis, cero de seis: «el administrador único
de la mercantil del polígono de Alcobendas» identifica a una persona y no hay nada que tachar. Y un
apellido que coincide con una institución —puse a propósito un «Lorenzo Guardia Civil» en el corpus
de validación— no se tapa, porque la guardia protege «Guardia Civil». Es el precio de que los
órganos salgan siempre en claro, y me parece el lado correcto en el que equivocarse, pero es un
agujero y prefiero que lo sepas por mí.

**Una salvedad sobre el corpus de validación, para que el número no valga más de lo que vale.** Era
ciego hasta que lo corrí: me destapó ocho huecos de la guardia —consejerías autonómicas, la Xunta,
el IMSERSO, tipos de procedimiento como el concurso o el arbitraje— y los he cerrado, de forma
genérica y no caso a caso. Así que para la guardia ya no es del todo ciego; para el resto sí.

**Dos correcciones a cosas que te di por buenas y tú verificaste.** Las vi escribiendo esto:

*El `resellar()` de la caché.* Te dije que cabía «casi sin obra». Está mal, y es mío. Admite tres
campos, aplica el mismo valor a **todos** los fragmentos del documento y reescribe el `.jsonl`
entero copiando el fichero de vectores en cada llamada. Es lo contrario de una caché por fragmento.

*«La librería es la misma, solo entra un peso nuevo».* Incompleto. `@xenova/transformers` devuelve
`start: null` y `end: null` en cada token —está escrito en su propio código, `// TODO: null for now,
but will add`—. Sin posiciones no se puede cortar el texto, así que hay que reconstruirlas. Lo he
tenido que escribir y funciona, pero es código nuestro que no estaba en la cuenta. De hecho mi
primera corrida daba un 8 % para el modelo pequeño y era culpa mía: al no plegar mayúsculas y
tildes en el cotejo, no encontraba ni un token. Arreglado, saltó al 95 %.

**Dónde queda.** Esto ya no es un banco, es el filtro, con sus pruebas y sin tocar una línea de
`server/`. Lo que necesito de ti antes de enchufarlo:

- **El corpus lo he escrito yo**, con nombres inventados. Necesito repetir la medición sobre
  expedientes de verdad antes de que esto se prometa por escrito en ningún sitio. Dime cómo lo
  hacemos sin sacar documentos de un despacho.
- **Qué opinas de la lista de categoría especial.** Va al final de este correo, con las nueve dudas
  concretas que me han salido al escribirla. Las tres que más me interesan son las mismas por
  dentro: la incapacidad permanente, el embarazo y el alcoholismo son dato de salud, pero a veces
  son **el objeto del pleito**, y taparlos deja la demanda incomprensible. Dime qué te sobra y qué
  te falta, como hiciste con la de intocables.
- **Y una que quizá te sorprenda:** viendo que las reglas hacen el 98 % y el modelo el 1 %, me
  planteo salir sin modelo en la v1. Cero MB de instalador, cero segundos de latencia, y la
  diferencia es un nombre de cada noventa. Pero es un nombre real de un cliente real, así que esa
  decisión no la tomo yo solo.

Un abrazo,

---

# Anexo — Lista de categoría especial (art. 9.1 RGPD)

Esto es lo que el detector tapa hoy, agrupado por las categorías del 9.1. Sale del código, no de
memoria. Al final van las **nueve dudas** que quiero contrastar contigo: son decisiones que he
tenido que tomar sobre la marcha y que tienen componente jurídico, no técnico.

Recordatorio del criterio que cerramos: en categoría especial se tapa **siempre en caso de duda**,
al revés que en el resto del filtro. Así que aquí un falso positivo cuesta una palabra del escrito
y un falso negativo manda la salud de un cliente a un tercero.

---

## 1. Salud

**a) Por la forma de la palabra.** Cualquier término acabado en un sufijo clínico, con sus
adjetivos detrás: `-itis, -osis, -emia, -patía, -algia, -ectomía, -plastia, -scopia, -terapia,
-oma, -iasis, -penia, -trofia, -plejía, -paresia, -fagia, -uria, -cardia, -dinia`.

> «espondilitis anquilosante con afectación sacroilíaca bilateral», «artrosis degenerativa»,
> «cardiopatía isquémica», «lumbalgia crónica»

Esta es la vía que más cubre: no depende de ninguna lista cerrada de enfermedades.

**b) Por el contexto que lo anuncia.** «diagnosticado de X», «padece X», «sufre X», «aquejado de
X», «refiere un X», «presenta un X», «trastorno de X», «síndrome de X», «episodio de X», «cuadro
de X», «secuelas de X», «en tratamiento con X», «con seguimiento en X», «grado de discapacidad
de X». Se tapa **X**, no el verbo.

**c) Episodio o cuadro con adjetivo.** «un episodio depresivo mayor», «un cuadro ansioso reactivo»,
«un brote psicótico agudo».

**d) Patologías nombradas.** diabetes (mellitus / tipo N / insulinodependiente) · cáncer ·
carcinoma · tumor · VIH · sida · hepatitis A/B/C · esquizofrenia · depresión (mayor / crónica) ·
ansiedad · bipolaridad · anorexia · bulimia · alzhéimer · párkinson · epilepsia · asma ·
fibromialgia · esclerosis (múltiple) · ictus · infarto · alcoholismo · ludopatía · toxicomanía ·
drogodependencia · discapacidad (física / psíquica / intelectual / sensorial) · invalidez ·
incapacidad (permanente / laboral, total / absoluta / parcial) · embarazo · gestación · aborto ·
interrupción voluntaria del embarazo.

**e) Documentos clínicos.** historia/historial clínico · informe médico · parte de baja · baja
médica o laboral · alta médica · ingreso hospitalario · tratamiento psiquiátrico / psicológico /
oncológico · seguimiento en salud mental.

**f) Medicación.** Por la terminación del principio activo: `-pram, -zepam, -zolam, -olol, -pril,
-sartán, -statina, -cilina, -micina, -azol, -tidina, -caína, -fenaco, -profeno, -metacina`. Y la
lista entera detrás de «en tratamiento con» (para que «interferón beta y sertralina» se tape
completa, no solo el primero).

## 2. Afiliación sindical

Afiliado a / afiliación sindical · delegado o representante sindical · «sindicato X» ·
CCOO · Comisiones Obreras · UGT · CGT · CNT · USO · ELA · LAB · CSIF · SATSE.

## 3. Convicciones religiosas o filosóficas

«profesa la religión X» · religión católica, evangélica, musulmana, judía, ortodoxa, protestante,
hindú, budista · «es católico / evangélico / musulmán / judío / testigo de Jehová / ateo /
agnóstico» · creencias religiosas · convicciones religiosas o filosóficas · objeción de conciencia.

## 4. Opiniones políticas

Afiliado al partido X · militante de X · simpatizante de X · ideología política · opiniones
políticas.

## 5. Origen étnico o racial

«de etnia X» · etnia gitana · pueblo gitano · comunidad gitana · minoría étnica · origen étnico o
racial.

## 6. Vida y orientación sexual

Orientación sexual · identidad de género · «es homosexual / bisexual / transexual / transgénero /
lésbica / gay» · homosexualidad · transexualidad · cambio de sexo · reasignación de género · vida
sexual.

## 7. Datos genéticos y biométricos

Perfil genético · prueba de ADN · prueba de paternidad · muestra de ADN · ácido
desoxirribonucleico · análisis genético · huella dactilar · reconocimiento facial · datos
biométricos.

---

## Lo que se salva a propósito

No se tapa, aunque lleve vocabulario clínico, porque es la maquinaria del proceso y no el dato de
nadie: **Juzgado de Violencia sobre la Mujer**, **Servicio de Reumatología**, **Hospital / Instituto
/ Centro <lo que sea>**, **Instituto de Medicina Legal**, **Médico Forense**.

---

## Las nueve dudas

1. **La incapacidad permanente, ¿es dato de salud o situación procesal?** Hoy se tapa, pero tuve
   que meter una excepción fea: en «la resolución que le deniega la incapacidad permanente total.»
   es el objeto del pleito, no un dato clínico, y taparlo deja el escrito sin sentido. La excepción
   actual es un apaño (se salva solo cuando va al final de la frase) y quiero sustituirla por un
   criterio tuyo.

2. **La discapacidad sin diagnóstico.** «Grado de discapacidad del 33 %» no dice qué tiene, solo
   que tiene algo. ¿Dato de salud del 9.1 o no?

3. **El país de origen.** Hoy **no** se tapa: «nacido en Nador (Marruecos)» sale en claro, porque
   nacionalidad no es origen étnico. Pero en un expediente de extranjería la frontera se difumina.
   ¿Lo dejo así?

4. **Los antecedentes penales.** Hoy **no** se tapan. Formalmente no son 9.1 sino artículo 10, con
   su propio régimen. Pero en un escrito penal es de lo más sensible que hay. ¿Los meto?

5. **Los documentos clínicos por su nombre.** ¿Tapar «se aporta la historia clínica» y «parte de
   baja»? No son el dato, son el continente. Yo los tapo por si acaso, pero me chirría.

6. **El embarazo.** Lo tengo como dato de salud. En una demanda por despido nulo el embarazo **es**
   el hecho que se litiga, así que taparlo deja la demanda incomprensible. Misma tensión que el
   punto 1.

7. **La medicación por terminación.** `-olol`, `-pril` y `-statina` cogen cualquier antihipertensivo
   o estatina, que dicen bastante de la salud de alguien. ¿Vas de acuerdo, o es demasiado?

8. **La objeción de conciencia** la tengo en convicciones filosóficas. ¿Correcto?

9. **El alcoholismo, la ludopatía y la toxicomanía.** Dato de salud, sí — pero en un penal o en una
   modificación de medidas son el hecho central del asunto. ¿Se tapan igual?

En las dudas 1, 6 y 9 late el mismo problema: **el dato sensible es a veces el objeto del pleito**.
Si lo tapamos siempre, el escrito deja de servir; si lo dejamos pasar, sale lo más delicado que hay.
Se me ocurre una tercera vía —taparlo en los documentos y dejarlo en el petitum y los fundamentos—
pero eso ya es criterio jurídico y prefiero que lo pongas tú.
