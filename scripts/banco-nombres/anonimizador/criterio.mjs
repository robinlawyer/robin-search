// EL CRITERIO EXTENDIDO (2-oct, pendiente de Juan). Juan cerró el criterio de fondo para la
// incapacidad permanente, el embarazo, las adicciones y los antecedentes. Extenderlo a la
// afiliación sindical (tutela de libertad sindical), la orientación sexual (asilo), el origen
// étnico (discriminación), la discapacidad (medidas de apoyo) y la patología cuya ocultación o
// retraso diagnóstico es el pleito es una decisión jurídica suya, no de este código. Hasta que la
// tome, se tapan (en la duda, se tapa), y queda escrito y medido detrás de un solo interruptor.
export const CRITERIO_EXTENDIDO = process.env.ROBIN_CRITERIO_EXTENDIDO === '1';
export const EXTENDIDAS = new Set(['SINDICAL', 'ORIENTACION', 'ETNIA', 'DISCAPACIDAD', 'PATOLOGIA']);
