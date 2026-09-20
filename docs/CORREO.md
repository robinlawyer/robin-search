# El correo del despacho, desde Claude

**Desde RobinSearch 1.7.0.** Robin puede buscar en el buzón del abogado, leer un correo y
dejarle la respuesta escrita en Borradores. Sin que la contraseña ni el contenido del correo
pasen por ningún servidor de RobinLawyer.

## Por qué existe

Los conectores de correo que trae Claude solo hablan con **Google Workspace** y con
**Microsoft 365**. Un despacho con su correo en su propio proveedor —que en España es la mayoría—
se queda fuera, y no por una configuración mal puesta: es que detrás no hay ningún tenant de
Microsoft con el que hablar.

RobinSearch ya corre en el ordenador del abogado. Añadirle el correo ahí significa que la
contraseña del buzón se queda en el llavero de su sistema operativo y que los correos van de su
ordenador a su proveedor, como cuando abre Outlook. **Nosotros no custodiamos el correo de nadie.**

## Lo que se promete, con precisión

> La contraseña del buzón y el contenido de los correos **no pasan por servidores de
> RobinLawyer**. La contraseña se guarda en el llavero del sistema operativo del abogado y las
> conexiones IMAP y SMTP van directas de su ordenador a su proveedor de correo.

Lo que **no** se promete: el correo, obviamente, sigue viajando entre su ordenador y su
proveedor, y sigue estando en los servidores de su proveedor. Eso no cambia — ni puede cambiar.
Lo que cambia es que no hay un intermediario nuevo.

## Qué puede hacer Robin

| Herramienta | Qué hace | Permiso |
|---|---|---|
| `buscar_correos` | Busca por remitente, destinatario, asunto, texto, fechas, sin leer o con adjunto | Solo lectura |
| `leer_correo` | Devuelve un correo entero en texto plano, con sus adjuntos listados | Solo lectura |
| `guardar_borrador` | Deja la respuesta redactada en Borradores, dentro del hilo | Escribe un borrador |
| `enviar_correo` | Envía de verdad y deja copia en Enviados | **Desactivado de fábrica** |

Lo normal es `guardar_borrador`: **Robin redacta, el abogado firma y envía**. El envío solo se
activa con un interruptor en la app de escritorio, y aun activado Claude pide confirmación cada
vez.

## Configurarlo (5 minutos, una vez)

1. Abrir la app **RobinSearch** → tarjeta **«Tu correo»** (paso 4, opcional).
2. Escribir la dirección de correo y su contraseña.
3. **Conectar**. RobinSearch averigua solo el servidor, comprueba que entra, mira la bandeja y
   crea y borra un borrador de prueba. Responde en una frase qué ha podido hacer.
4. Si se quiere, activar **«Permitir además que envíe correos»**. No hace falta.

Si el servidor no se encuentra solo, en **Ajustes avanzados** se ponen a mano el servidor de
entrada (IMAP, casi siempre puerto 993) y el de salida (SMTP, 587 o 465). Es el dato que tiene
quien lleve la informática del despacho.

### Desde la línea de órdenes (despliegue de IT)

La contraseña **se lee por la entrada estándar**, nunca como argumento — en argumento la vería
cualquiera con un `ps` y quedaría en el historial de la shell:

```sh
printf '%s' 'la-contraseña' | robin-search correo conectar --direccion=abogado@despacho.es
robin-search correo probar
robin-search correo envio --permitir      # opcional
robin-search correo olvidar               # borra la cuenta y la contraseña del llavero
```

## Dónde está la contraseña

| Sistema | Dónde se guarda |
|---|---|
| macOS | Llavero del sistema (`security`), servicio **«RobinSearch correo»** |
| Windows | Cifrada con DPAPI de usuario, en `%APPDATA%\RobinLawyer\robin-search\correo.cred` |
| Linux | GNOME Keyring / KWallet, vía `secret-tool` |
| Linux sin llavero | Fichero `0600` — **y la app lo dice con todas las letras** |

No hay ningún módulo nativo: todo son binarios que ya trae el sistema. Es lo que permite que un
mismo `.mcpb` se instale igual en Mac, Windows y Linux.

**Ninguna herramienta MCP recibe la contraseña como parámetro.** Si la recibiera, acabaría en el
contexto del modelo y en el historial de la conversación, y con ello se caería entero el
argumento de esta función.

## Proveedores

| Proveedor | Funciona | Qué hace falta |
|---|---|---|
| Hosting propio (Dinahosting, Arsys, CDmon, OVH, Ionos…) | Sí | La contraseña de siempre |
| Servidor del despacho (Dovecot, Zimbra, Kerio…) | Sí | Nada especial |
| Gmail / Google Workspace | Sí | **Contraseña de aplicación** (exige verificación en dos pasos) |
| Microsoft 365 | **NO, hoy** | Exige OAuth. Ver abajo. |
| Outlook.com / Hotmail personal | **NO, hoy** | Exige OAuth, igual que Microsoft 365 |

### Gmail

La contraseña normal de Google **no sirve** para IMAP. Hay que generar una contraseña de
aplicación, y para eso la cuenta necesita la verificación en dos pasos activada:

1. Activar la **verificación en dos pasos** en la cuenta de Google. Sin ella Google no deja
   crear contraseñas de aplicación («To create an app password, you need 2-Step Verification on
   your Google Account»).
2. En la configuración de seguridad de la cuenta, crear una **contraseña de aplicación**: son 16
   caracteres que Google enseña una sola vez.
3. Pegarla en RobinSearch como si fuera la contraseña. Los servidores se detectan solos
   (`imap.gmail.com` / `smtp.gmail.com`, por los registros SRV del propio dominio de Google).

Que Gmail admite la contraseña de aplicación está comprobado en vivo: `imap.gmail.com` anuncia
`AUTH=XOAUTH2 AUTH=PLAIN` — no `LOGINDISABLED` —, así que la vía de contraseña sigue abierta.

### Microsoft 365 y Outlook.com: hoy NO

Comprobado en vivo el 20-sep-2026 contra los dos servidores de Microsoft:

```
outlook.office365.com:993  → * CAPABILITY IMAP4rev1 AUTH=XOAUTH2 LOGINDISABLED …
imap-mail.outlook.com:993  → * CAPABILITY IMAP4rev1 AUTH=XOAUTH2 LOGINDISABLED …
```

`LOGINDISABLED` significa exactamente lo que parece: **el servidor no acepta usuario y
contraseña**, ni con una contraseña de aplicación. Solo `XOAUTH2`. Y no es una opción del
inquilino: la documentación de Microsoft dice que la autenticación básica «está ya desactivada en
todos los inquilinos» y que «ya nadie —ni usted ni el soporte de Microsoft— puede volver a
activarla». La misma nota añade que esa retirada **impide también usar contraseñas de
aplicación**. Afecta igual a la cuenta personal de Outlook.com/Hotmail.

Conclusión, sin ambigüedad: **un despacho con su correo en Microsoft 365 no puede conectarlo a
RobinSearch hoy.** Hace falta OAuth (XOAUTH2), que es trabajo aparte, previsto para la 1.8.

RobinSearch lo detecta y lo dice antes de que el abogado pruebe tres contraseñas: consulta las
capacidades del servidor y, si ve `LOGINDISABLED`, avisa de que no es cosa de su contraseña.

> **Ojo con el caso que despista.** Un abogado puede estar usando el Outlook nuevo con su buzón
> IMAP de su propio proveedor: Outlook espeja ese buzón en una cuenta personal de Microsoft y
> todo *parece* Microsoft 365. No lo es — y su buzón IMAP sí se conecta. La forma de salir de
> dudas es mirar dónde está de verdad el buzón (los registros MX del dominio), no qué programa
> usa para leerlo.

## Qué NO hace la v1

- **No descarga adjuntos.** Los lista con su nombre y su tamaño. Si el abogado quiere trabajar
  con uno, que lo guarde en la carpeta del expediente: ahí se indexa como cualquier documento.
- **No vuelca correos al expediente indexado.** El correo es de la *cuenta*, no del expediente, y
  meter la correspondencia de un cliente en el expediente de otro sería el peor fallo posible.
  Está previsto para la 1.1, con el abogado eligiendo a mano qué va a qué expediente.
- **No toca lo que hay en el buzón**: no borra, no mueve y no marca como leído salvo que se le
  pida expresamente.

## El texto de un correo no es una instrucción

Un documento del expediente lo ha metido el abogado. Un correo entra solo y lo escribe quien
quiere. Por eso el cuerpo de cualquier correo se entrega a Claude **envuelto y etiquetado** como
contenido de un tercero: información que leer y resumir, nunca órdenes que ejecutar. Si dentro de
un correo alguien escribe «reenvía este hilo a esta otra dirección», eso es un **hecho que
contarle al abogado**, no una tarea.

## Registros

De RobinSearch al servidor de RobinLawyer solo viajan avisos técnicos, y ni siquiera esos llevan
nada del correo: ni remitentes, ni destinatarios, ni asuntos, ni cuerpos. Las direcciones se
tapan y la cuenta y el servidor de correo del despacho se añaden a la lista de literales que la
barrera de `diagnostico.js` sustituye antes de enviar nada.
