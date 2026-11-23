// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplateCopyEs } from "./types";

export const COPY_ES_A2: Record<string, CourseTemplateCopyEs> = {
  "enriched-air-nitrox-diver": {
    description: "Aprende a planificar y bucear con Nitrox de hasta 40% de oxígeno.",
    summary:
      "Más tiempo de fondo en inmersiones repetitivas, y la planificación que lo hace seguro",
    overview:
      "El Nitrox es aire común con más oxígeno y menos nitrógeno. Menos nitrógeno significa una absorción más lenta de nitrógeno, lo que normalmente se traduce en límites de no descompresión más largos — la diferencia se nota más en la segunda y la tercera inmersión del día.\n\nA cambio hay un nuevo límite que respetar. El oxígeno pasa a ser lo que puedes tener en exceso, así que cada inmersión tiene una profundidad máxima de operación determinada por la mezcla. El curso te enseña a analizar tu propio tanque, registrar el resultado, configurar tu computadora con la mezcla que realmente tienes y calcular la profundidad que no debes sobrepasar.\n\nLa certificación cubre mezclas recreativas de 22% a 40% de oxígeno. No hay inmersiones de entrenamiento obligatorias — es un curso de conocimientos y habilidades prácticas — aunque normalmente hacemos dos inmersiones con él para que uses los procedimientos de verdad.",
    durationText: "1 día · sesiones de conocimientos y práctica",
    groupSizeText: "Un grupo pequeño, trabajando con el analizador y con tu propia computadora",
    prerequisiteNote:
      "PADI Open Water Diver o superior, de PADI o de otra agencia, y tener al menos 12 años. Los Junior Open Water Divers de 10 a 11 años tienen edad para la certificación, pero no para este curso; la edad mínima de la agencia es 12. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Uso del analizador y práctica de registro de tanques",
    ],
    excludes: [
      "Las dos inmersiones opcionales — el barco, los tanques y el Nitrox de esas inmersiones se cobran juntos si las agregas",
      "Alquiler de equipo personal",
      "Recargas de Nitrox después del curso",
    ],
    scheduleDays: [
      {
        title: "Día del curso",
        items: [
          "Desarrollo de conocimientos: exposición al oxígeno, absorción de nitrógeno y qué cambia",
          "Calcular la profundidad máxima de operación a partir de la mezcla, y la mezcla a partir de la profundidad",
          "Práctica: analizar dos tanques, registrarlos y configurar tu computadora con la mezcla",
          "Dos inmersiones opcionales con Nitrox, usando los procedimientos de principio a fin",
        ],
      },
    ],
    faqs: [
      {
        question: "¿El Nitrox me deja bucear más profundo?",
        answer:
          "No — al contrario. Ahora tienes dos límites: el que te da tu certificación y una profundidad máxima de operación determinada por tu mezcla y un tope de presión parcial de oxígeno de 1.4 bar. El que sea más somero es tu límite para esa inmersión. El Nitrox te da tiempo de fondo, no profundidad.",
      },
      {
        question: "¿Para qué mezclas me certifica?",
        answer:
          "Hasta 40% de oxígeno. Cualquier mezcla más rica es un curso de buceo técnico, con equipo y procedimientos distintos.",
      },
      {
        question: "¿Hay inmersiones obligatorias?",
        answer:
          "No según el estándar — puedes certificarte solo con las sesiones de desarrollo de conocimientos y de aplicación práctica. Aun así, normalmente agregamos dos inmersiones, porque analizar un tanque en un barco en movimiento es una habilidad distinta a hacerlo en una mesa.",
      },
      {
        question: "¿Necesito mi propia computadora?",
        answer:
          "No, pero trae la tuya si tienes una. Aprender los menús en la computadora con la que realmente buceas es la mayor parte del valor práctico.",
      },
      {
        question: "¿Todas las inmersiones serán más largas?",
        answer:
          "No. En una sola inmersión somera probablemente se te acabe el aire o llegue la hora del barco mucho antes del límite de no descompresión. La ganancia se nota en las inmersiones repetitivas entre {depth18n} y {depth30}.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
  "peak-performance-buoyancy": {
    description: "Dos inmersiones dedicadas a corregir el lastre, el trimado y el control.",
    summary: "Deja de pelear con el agua y empieza a flotar en ella",
    overview:
      "La flotabilidad es la habilidad que hace más fáciles todas las demás. Los buceadores que se mantienen suspendidos usan menos aire, levantan menos sedimento, no dañan nada y se ven tranquilos porque lo están.\n\nEl curso consta de dos inmersiones y el trabajo entre ellas. Empiezas con una revisión real del lastre — la mayoría de los buceadores carga varios kilos que no necesita — y luego mueves el peso hasta quedar horizontal en el agua en vez de ir de pie en ella. Después es práctica: mantenerte suspendido sin usar las manos, pasar por espacios estrechos, ascender a un ritmo controlado sin cabo.\n\nEs el curso menos espectacular que damos y el que más cambia la forma de bucear de la gente.",
    durationText: "1 día · 2 inmersiones",
    groupSizeText:
      "Un grupo pequeño, para que tu instructor pueda observar a cada buceador mantenerse suspendido",
    prerequisiteNote:
      "PADI Open Water Diver o superior, de PADI o de otra agencia. Los buceadores de 10 a 11 años lo toman como Junior Open Water Divers y mantienen su límite de profundidad de {depth12} y los requisitos de supervisión. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Dos inmersiones de entrenamiento",
      "Tanques, lastre y barco",
    ],
    excludes: ["Alquiler de equipo personal", "Fotos submarinas"],
    scheduleDays: [
      {
        title: "Día del curso",
        items: [
          "Repaso de conocimientos: lastre, trimado y qué es lo que realmente te sube y te baja",
          "Inmersión 1: revisión correcta del lastre, distribución del peso y giros con las aletas",
          "Intervalo en superficie — ajusta la colocación del lastre y la posición del equipo",
          "Inmersión 2: mantenerte suspendido sin manos, nadar un circuito de flotabilidad, ascenso controlado",
        ],
      },
    ],
    faqs: [
      {
        question: "Solo tengo unas pocas inmersiones. ¿Es muy pronto para esto?",
        answer:
          "No. Cuanto antes, mejor — tienes menos hábitos que desaprender. Puedes tomarlo justo después de Open Water.",
      },
      {
        question: "¿De verdad voy a usar menos aire?",
        answer:
          "Normalmente sí, aunque no está garantizado y nadie puede prometer una cifra. La mayor parte de la ganancia viene de no nadar contra tu propia flotabilidad toda la inmersión.",
      },
      {
        question: "¿Debo traer mi propio equipo?",
        answer:
          "Si tienes BCD, traje húmedo o aletas, tráelos. El lastre depende del equipo que usas, así que una revisión con equipo de alquiler te dice menos sobre el tuyo.",
      },
      {
        question: "¿Esto cuenta para Advanced Open Water?",
        answer:
          "Sí. La primera inmersión se acredita como la inmersión de aventura de Peak Performance Buoyancy si continúas con el curso Advanced Open Water Diver, y también funciona al revés.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
  "night-diver": {
    description: "Tres inmersiones al caer la noche, con luces, señales y navegación.",
    summary: "El mismo arrecife, un animal completamente distinto",
    overview:
      "Un arrecife que conoces bien es un desconocido después del anochecer. Los peces del día duermen en el coral, salen los cazadores y los pólipos del coral se abren para alimentarse. Tu mundo se reduce al haz de tu luz, que es justo lo que lo hace sentir más grande.\n\nEl curso consta de tres inmersiones. Aprendes a manejar la luz y sus señales, a mantenerte con tu compañero cuando no le ves la cara, a navegar cuando las referencias que usas de día son invisibles y qué hacer si falla tu luz principal — por eso llevas una de respaldo.\n\nLa primera inmersión suele empezar al atardecer, para que entres con la luz que se apaga y veas cómo ocurre el cambio. Las siguientes son en plena oscuridad.",
    durationText: "2 noches · 3 inmersiones",
    groupSizeText: "Un grupo pequeño — más pequeño de noche que el que armamos de día",
    prerequisiteNote:
      "PADI Open Water Diver o superior, de PADI o de otra agencia, y tener al menos 12 años. Los buceadores de 12 a 14 años se certifican como Junior Night Divers y mantienen los requisitos de supervisión que acompañan a su certificación. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Tres inmersiones nocturnas de entrenamiento",
      "Luces de buceo principal y de respaldo",
      "Tanques, lastre y barco",
    ],
    excludes: ["Alquiler de equipo personal", "Cena entre inmersiones"],
    scheduleDays: [
      {
        title: "Noche 1 — atardecer y oscuridad",
        items: [
          "Repaso de conocimientos: luces, señales, contacto con el compañero y procedimiento si se pierde la luz",
          "Revisión del equipo y de la luz a plena luz del día, antes de necesitarlos",
          "Inmersión 1: entrada al atardecer, manteniéndote con tu compañero mientras se va la luz",
          "Inmersión 2: señales de luz y comunicación en plena oscuridad",
        ],
      },
      {
        title: "Noche 2 — navegación",
        items: [
          "Inmersión 3: navegación nocturna con brújula y referencias naturales",
          "Encontrar el barco o el punto de salida sin guía",
          "Repaso final y papeleo de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Es peligroso el buceo nocturno?",
        answer:
          "Es distinto, no temerario. Los riesgos adicionales son perder a tu compañero, perder tu luz y perder la orientación — el curso son tres inmersiones dedicadas a convertir cada uno de ellos en un procedimiento y no en una sorpresa.",
      },
      {
        question: "¿Qué profundidad alcanzan las inmersiones nocturnas?",
        answer:
          "Menos que las de día — nuestras inmersiones nocturnas de entrenamiento se mantienen muy por debajo de {depth18}. Tu límite de certificación sigue aplicando, y de noche no hay nada en la profundidad que no puedas ver a {depth12}.",
      },
      {
        question: "¿Necesito comprar una luz?",
        answer:
          "Te damos una principal y una de respaldo para el curso. Si piensas seguir buceando de noche, compra la tuya — vale más una luz cuyo interruptor conoces que una más potente que no.",
      },
      {
        question: "¿Y si no me gusta?",
        answer:
          "A algunos buceadores no les gusta, y es un resultado perfectamente válido. Díselo a tu instructor y terminamos la inmersión; nunca te convencen de meterte al agua.",
      },
      {
        question: "¿Esto cuenta para Advanced Open Water?",
        answer:
          "Sí. La primera inmersión se acredita como la inmersión de aventura nocturna en el curso Advanced Open Water Diver, en cualquier dirección.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
  "deep-diver": {
    description: "Cuatro inmersiones que amplían tu límite a {depth40}, hechas como se debe.",
    summary: "Cómo bucear entre {depth18n} y {depth40} y volver con tu plan intacto",
    overview:
      "Bucear profundo no es cuestión de valentía. Es cuestión de qué tan poco margen tienes: el aire se acaba más rápido, los límites de no descompresión se reducen, la narcosis es real y la superficie queda más lejos cuando algo sale mal.\n\nEl curso consta de cuatro inmersiones, la más profunda a un máximo de {depth40} — el límite del buceo recreativo, y lo más profundo a lo que te llevará esta certificación. Planificarás el gas y el tiempo antes de mojarte, practicarás el uso de un tanque de seguridad en un cabo y verás por ti mismo lo que te hace la narcosis haciendo una tarea sencilla a profundidad y otra vez en la superficie.\n\nEl color también desaparece con la profundidad. Trae una luz y observa qué le pasa al rojo a {depth30}.",
    durationText: "2 días · 4 inmersiones",
    groupSizeText:
      "Un grupo pequeño — las inmersiones más profundas implican menos buceadores por instructor",
    prerequisiteNote:
      "PADI Advanced Open Water Diver o superior, y tener al menos 15 años. ¿Tienes PADI Adventure Diver? Llámanos antes de reservar. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Cuatro inmersiones de entrenamiento, la última a un máximo de {depth40}",
      "Tanque de seguridad y cabo",
      "Tanques, lastre y barco",
    ],
    excludes: [
      "Recargas de Nitrox",
      "Alquiler de equipo personal",
      "Alquiler de computadora de buceo",
    ],
    scheduleDays: [
      {
        title: "Día 1 — planificación y las dos primeras inmersiones",
        items: [
          "Desarrollo de conocimientos: planificación del gas, narcosis, descompresión y contingencias",
          "Inmersión 1: a {depth18n}–{depth30}, con una tarea de comparación de la narcosis",
          "Inmersión 2: a {depth30}, contacto con el compañero y disciplina con la presión de retorno",
          "Repaso: qué hizo realmente tu consumo de aire",
        ],
      },
      {
        title: "Día 2 — más profundo, con un plan de parada de seguridad",
        items: [
          "Inmersión 3: a {depth30n}–{depth40}, con un tanque de seguridad colocado en el cabo",
          "Inmersión 4: a un máximo de {depth40}, planificada y dirigida por ti",
          "Parada de descompresión de emergencia simulada con el tanque de seguridad, y disciplina de ascenso",
          "Firma del registro de inmersiones y papeleo de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Hasta qué profundidad me certifica para bucear?",
        answer:
          "{depth40}, que es el límite del buceo recreativo. Más allá de eso no es una especialidad — es buceo técnico, con equipo y entrenamiento distintos.",
      },
      {
        question: "¿Debo bucear con Nitrox en las inmersiones profundas?",
        answer:
          "Ayuda con la absorción de nitrógeno, pero el límite de oxígeno se vuelve más somero a medida que la mezcla es más rica, y a {depth40} las mezclas estándar de la mayoría de los centros ya sobrepasan su límite, así que lo habitual es respirar aire. Toma el curso de Nitrox y planifica cada inmersión con sus propios números.",
      },
      {
        question: "¿Cómo se siente la narcosis?",
        answer:
          "Distinto para cada persona — normalmente un retraso al pensar, a veces exceso de confianza, ocasionalmente ansiedad. En la inmersión 1 harás una tarea sencilla a profundidad y otra vez en la superficie, y compararás. Eso es más útil que cualquier descripción.",
      },
      {
        question: "¿Necesito mi propia computadora de buceo?",
        answer:
          "Deberías estar buceando con una, y para este curso esperamos que cada buceador tenga computadora. Las alquilamos si no tienes una.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones, y tómalo como un piso y no como una meta. El buceo profundo repetitivo es el caso en que vale la pena la incomodidad de esperar más en superficie antes de un vuelo.",
      },
    ],
  },
  "wreck-diver": {
    description: "Cuatro inmersiones en naufragios, con mapeo, cabos y penetración limitada.",
    summary: "Bucea naufragios con un levantamiento, un cabo y una salida",
    overview:
      "Los naufragios son los mejores arrecifes artificiales que existen, y los lugares donde menos se perdona improvisar. Acero filoso, sedimento que queda suspendido una hora una vez que lo remueves y techos que te quitan la ruta directa a la superficie.\n\nEl curso consta de cuatro inmersiones. Primero levantas y mapeas un naufragio desde afuera, aprendes a buscar peligros y puntos de entrada antes de tomar ninguno y luego practicas tender y seguir un cabo de penetración, de modo que una pérdida de visibilidad tenga una respuesta con cuerda y no una respuesta a ciegas. Solo la cuarta inmersión implica penetración limitada, y solo dentro de la zona de luz.\n\nLa penetración recreativa en naufragios se mantiene somera y corta: tu profundidad más la distancia que nadas por dentro se queda dentro de {depth40} de la superficie, y te mantienes en una guía continua hasta la salida. Más profundo o más lejos es entrenamiento técnico en naufragios, que es otro curso.",
    durationText: "2 días · 4 inmersiones",
    groupSizeText: "Un grupo pequeño — todavía más pequeño en la inmersión de penetración",
    prerequisiteNote:
      "PADI Advanced Open Water Diver o superior, y tener al menos 15 años. ¿Tienes PADI Adventure Diver? Llámanos antes de reservar. Deep Diver no es obligatorio, pero los naufragios a más de {depth18} son un buen motivo para tenerlo. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Cuatro inmersiones de entrenamiento",
      "Carretes, cabos y pizarras",
      "Tanques, lastre y barco",
    ],
    excludes: [
      "Alquiler de equipo personal",
      "Luz de buceo — trae la tuya o alquila una con nosotros; necesitas una para la inmersión de penetración.",
      "Recargas de Nitrox",
    ],
    scheduleDays: [
      {
        title: "Día 1 — levantamiento desde afuera",
        items: [
          "Desarrollo de conocimientos: peligros, sedimento, enredos y por qué no te llevas recuerdos",
          "Inmersión 1: orientación en el naufragio, quedándote afuera y detectando peligros",
          "Inmersión 2: mapeo y croquis del naufragio en una pizarra",
        ],
      },
      {
        title: "Día 2 — cabos y penetración limitada",
        items: [
          "Inmersión 3: tender un cabo de penetración por fuera del naufragio y luego seguirlo a ciegas",
          "Inmersión 4: penetración limitada dentro de la zona de luz, en una guía continua hasta la salida",
          "Repaso sobre planificación del gas, separación entre compañeros y reglas de retorno",
          "Firma del registro de inmersiones y papeleo de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Qué tan adentro de un naufragio voy a entrar?",
        answer:
          "No mucho, y solo en la última inmersión. La penetración recreativa en naufragios se queda dentro de la zona de luz, en una guía continua hasta la salida, con tu profundidad más la distancia de penetración dentro de {depth40} de la superficie.",
      },
      {
        question: "¿Necesito Deep Diver primero?",
        answer:
          "No. Pero muchos buenos naufragios están a más de {depth18}, y tu límite de profundidad sigue a tu certificación, no al naufragio. Si los sitios que quieres son profundos, toma también Deep Diver.",
      },
      {
        question: "¿Puedo llevarme algo del naufragio?",
        answer:
          "No. La mayoría de los naufragios están protegidos, algunos son tumbas de guerra, y retirar cualquier cosa suele ser ilegal además de irrespetuoso. Toma fotos.",
      },
      {
        question: "¿Y si el naufragio se llena de sedimento?",
        answer:
          "Por eso se tiende un cabo. El curso dedica una inmersión entera a seguir un cabo al tacto, porque el día en que lo necesitas es el día en que no puedes verlo.",
      },
      {
        question: "¿Qué naufragios vamos a bucear?",
        answer:
          "Depende de la temporada y de las condiciones de la superficie. Pregúntanos qué se puede bucear la semana que vengas — elegimos sitios que se ajusten al curso, y no al revés.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
};
