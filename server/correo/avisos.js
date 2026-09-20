// Textos que hacen falta ANTES de cargar nada pesado.
//
// Las herramientas de correo cargan imapflow, mailparser y nodemailer de forma perezosa: entre
// los tres son ~7,5 s de carga de módulos, y la inmensa mayoría de los abogados no conecta el
// correo — no puede pagarlo todo el mundo en cada arranque del servidor. Pero para decir «no hay
// cuenta conectada» no hace falta nada de eso, así que ese texto vive aquí.

export const SIN_CUENTA =
  'Todavía no hay ninguna cuenta de correo conectada. Ábrela en la app de RobinSearch → Tu correo. '
  + 'La contraseña se guarda en el llavero de este ordenador; RobinSearch nunca la pide por el chat.';

export const SIN_SECRETO =
  'La cuenta de correo está configurada pero su contraseña no está en el llavero de este '
  + 'ordenador. Vuelve a conectarla en la app de RobinSearch → Tu correo.';

export default { SIN_CUENTA, SIN_SECRETO };
