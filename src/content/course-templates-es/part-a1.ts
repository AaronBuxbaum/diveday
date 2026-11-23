// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplateCopyEs } from "./types";

export const COPY_ES_A1: Record<string, CourseTemplateCopyEs> = {
  "discover-scuba-diving": {
    description: "Una primera experiencia submarina supervisada, con un instructor.",
    summary: "Prueba el buceo por primera vez, con un instructor a tu lado",
    overview:
      "Discover Scuba Diving no es una certificación — es la tarde en que descubres si respirar bajo el agua es para ti. Un instructor te explica lo poco que importa, te ajusta el equipo y no se separa de ti en ningún momento.\n\nEmpezarás en aguas poco profundas y confinadas, practicarás cómo despejar la máscara y recuperar el regulador y, si te sientes cómodo, harás una inmersión somera en aguas abiertas. Nadie te califica y nadie baja más de lo que quiere.\n\nSi te encanta, tu instructor puede acreditar las habilidades que aprendas aquí para el curso Open Water Diver.",
    durationText: "Medio día · unas 3 horas",
    groupSizeText: "Un grupo pequeño, con tu instructor a tu lado",
    prerequisiteNote:
      "No necesitas certificación ni experiencia. Completarás un breve cuestionario médico; algunas respuestas requieren la autorización de un médico antes de que puedas bucear.",
    includes: [
      "Charla previa y sesión de habilidades con un instructor",
      "Equipo completo de alquiler",
      "Una inmersión somera en aguas abiertas",
    ],
    excludes: ["Fotos y video"],
    scheduleDays: [
      {
        title: "Tu tarde",
        items: [
          "Charla previa: cómo funciona el equipo y cómo respirar con él",
          "Aguas confinadas: despejar la máscara, recuperar el regulador, desplazarte",
          "Una inmersión somera en aguas abiertas, a un máximo de {depth12}, con tu instructor",
          "Repaso de la inmersión, y cómo se vería el curso Open Water como siguiente paso",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Necesito saber nadar?",
        answer:
          "Necesitas sentirte cómodo en el agua. Discover Scuba Diving no tiene prueba de natación, pero el curso Open Water completo sí.",
      },
      {
        question: "¿Qué tan profundo voy a bajar?",
        answer:
          "No más de {depth12}, y solo hasta donde tú te sientas a gusto. La mayoría de las primeras inmersiones se quedan mucho más someras.",
      },
      {
        question: "¿Quedo certificado después?",
        answer:
          "No — es un programa de experiencia, no una certificación. Si continúas con el curso Open Water Diver, tu instructor puede acreditar estas habilidades; pregúntanos cómo funciona según tus fechas.",
      },
      {
        question: "¿Y si me da pánico bajo el agua?",
        answer:
          "Tu instructor está al alcance de tu mano durante toda la inmersión. Terminarla antes de tiempo siempre está bien y pasa con frecuencia.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 12 horas después de una sola inmersión antes de volar — es un mínimo, no una garantía, así que deja más margen si puedes. Si estás en un crucero o tomas un vuelo a la mañana siguiente, avísanos al reservar.",
      },
    ],
  },
  "open-water-diver": {
    description: "El curso de certificación básico para buceadores nuevos.",
    summary: "Conviértete en buceador PADI Open Water Diver certificado",
    overview:
      "La certificación Open Water Diver es la que abre la puerta: te habilita para bucear hasta {depth18} con un compañero, en cualquier parte del mundo, sin instructor — en condiciones iguales o mejores que las de tu entrenamiento.\n\nEl curso tiene tres partes. El desarrollo de conocimientos cubre la presión, el aire y la planificación — la mayoría de los alumnos lo hace en línea antes de llegar. En aguas confinadas las habilidades se vuelven memoria muscular, en aguas poco profundas donde puedes ponerte de pie. Cuatro inmersiones en aguas abiertas lo juntan todo en el arrecife.\n\nNo se requiere experiencia previa. Sí necesitas sentirte cómodo en el agua: el curso incluye una nadada de 200 metros/yardas (o 300 con máscara, aletas y snorkel) sin límite de tiempo, además de 10 minutos de flotación o nado en el sitio.",
    durationText: "3 días",
    groupSizeText: "Máximo 8 alumnos por instructor",
    prerequisiteNote:
      "Los buceadores de 10 a 11 años se certifican como Junior Open Water Divers, bucean a un máximo de {depth12} y deben hacerlo con un profesional PADI o con uno de sus padres o tutores certificado; los de 12 a 14 años bucean hasta {depth18} con cualquier adulto certificado. Esas restricciones terminan a los 15. Todos los alumnos completan antes un cuestionario médico; algunas respuestas necesitan la autorización de un médico antes de entrar al agua.",
    includes: [
      "Tarifas de certificación de PADI",
      "Equipo completo de alquiler durante todo el curso",
      "Cuatro inmersiones de entrenamiento en aguas abiertas",
      "Almuerzo ligero en los días completos",
    ],
    excludes: ["Fotos submarinas"],
    scheduleDays: [
      {
        title: "Día 1 — aula y aguas confinadas",
        items: [
          "Papeleo, cuestionario médico y ajuste del equipo",
          "Repasos de conocimientos 1–2, con cuestionarios",
          "Evaluación de natación (sin límite de tiempo) y 10 minutos de flotación o nado en el sitio",
          "Inmersiones en aguas confinadas 1–2: armado del equipo, despeje de máscara, recuperación del regulador, flotabilidad",
        ],
      },
      {
        title: "Día 2 — aguas confinadas y primeras inmersiones en aguas abiertas",
        items: [
          "Repasos de conocimientos 3–4, con cuestionarios",
          "Inmersiones en aguas confinadas 3–5, con habilidades de falta de aire y retiro de la máscara",
          "Inmersiones en aguas abiertas 1–2 en un arrecife somero",
        ],
      },
      {
        title: "Día 3 — aguas abiertas y examen",
        items: [
          "Repaso de conocimientos 5 y el examen final",
          "Inmersiones en aguas abiertas 3–4, a un máximo de {depth18}",
          "Navegación, control de flotabilidad y repaso final",
          "Papeleo de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Qué tan profundo puedo bucear una vez certificado?",
        answer:
          "{depth18} como Open Water Diver, en condiciones iguales o mejores que las de tu entrenamiento. Advanced Open Water Diver lo amplía a {depth30}.",
      },
      {
        question: "¿Necesito ser un nadador fuerte?",
        answer:
          "Necesitas destreza básica en el agua: una nadada de 200 metros o 300 metros con snorkel, además de 10 minutos de flotación o nado en el sitio. La nadada no tiene límite de tiempo y cualquier estilo vale.",
      },
      {
        question: "¿El equipo está incluido?",
        answer:
          "Sí — máscara, aletas, traje húmedo, BCD, regulador, computadora, tanques y lastre se facilitan para el curso.",
      },
      {
        question: "¿Cuál es la edad mínima?",
        answer:
          "10 años. Los buceadores de 10 a 11 años se certifican como Junior Open Water Divers, bucean hasta {depth12} y deben ir acompañados por un profesional PADI o por uno de sus padres o tutores certificado. Los de 12 a 14 años bucean hasta {depth18} con cualquier adulto certificado. Ambas restricciones terminan a los 15.",
      },
      {
        question: "¿Puedo hacer la teoría antes de llegar?",
        answer:
          "Sí, y la mayoría de los alumnos lo hace. PADI eLearning se cobra por separado, en una línea aparte, y terminarlo antes te deja los días libres para bucear.",
      },
      {
        question: "¿Y si no termino en tres días?",
        answer:
          "El curso se basa en el desempeño, no en el reloj: te certificas cuando puedes hacer las habilidades. Si necesitas otra sesión, la programamos.",
      },
      {
        question: "¿La certificación caduca?",
        answer:
          "No. Si ha pasado un tiempo desde tu última inmersión, un repaso PADI ReActivate es buena idea antes de volver a bucear.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
  "advanced-open-water-diver": {
    description: "Gana confianza y alcance con cinco inmersiones de aventura.",
    summary: "Cinco inmersiones que te llevan más profundo, más lejos y con más confianza",
    overview:
      "Advanced Open Water Diver no es repetir Open Water con habilidades más difíciles — son cinco inmersiones, cada una un primer acercamiento a una especialidad distinta, bajo la supervisión de un instructor.\n\nDos son obligatorias: una inmersión profunda, que amplía tu límite a {depth30}, o a {depth21} para buceadores de 12 a 14 años, y una inmersión de navegación submarina. Las otras tres las eliges según lo que ofrezcan el sitio y la temporada — nocturna, de naufragio, de deriva, de flotabilidad, de naturalista y más.\n\nNo hay examen final. Hay un breve repaso de conocimientos antes de cada inmersión, y las inmersiones cuentan como inmersiones de entrenamiento.",
    durationText: "2 días · 5 inmersiones",
    groupSizeText: "Máximo 8 alumnos por instructor",
    prerequisiteNote:
      "PADI Open Water Diver (o una certificación equivalente de otra agencia) — verificamos el registro de tu certificación antes de la primera inmersión. Los buceadores de 12 a 14 años se certifican como Junior Advanced Open Water Divers y quedan limitados a {depth21}, incluida la inmersión profunda; los {depth30} completos llegan a los 15.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Cinco inmersiones de aventura supervisadas",
      "Tanques, lastre y barco",
    ],
    excludes: [
      "Alquiler de equipo personal",
      "Equipo especializado para las inmersiones opcionales",
    ],
    scheduleDays: [
      {
        title: "Día 1 — profunda y navegación",
        items: [
          "Repasos de conocimientos para las inmersiones del día",
          "Inmersión de aventura profunda — máximo {depth30}, o {depth21} para buceadores de 12 a 14 años",
          "Inmersión de navegación submarina: referencias naturales y brújula",
        ],
      },
      {
        title: "Día 2 — tres que tú eliges",
        items: [
          "Dos inmersiones de aventura por la mañana entre las opciones disponibles",
          "Una inmersión por la tarde o nocturna, según tu elección",
          "Firma del registro de inmersiones y papeleo de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Necesito ser un buceador con experiencia primero?",
        answer:
          "No. Puedes tomar Advanced Open Water Diver justo después de Open Water — el curso está diseñado para ir construyendo la experiencia, con supervisión.",
      },
      {
        question: "¿Qué tan profunda será la inmersión profunda?",
        answer:
          "Hasta un máximo de {depth30} — {depth21} si tienes de 12 a 14 años — y solo después de que tu instructor haya explicado la planificación del gas, la narcosis y el plan de ascenso.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía; la inmersión profunda, en particular, es un motivo para dejar más margen.",
      },
      {
        question: "¿Qué inmersiones de aventura puedo elegir?",
        answer:
          "Depende del sitio y de las condiciones. Pregúntanos qué hay disponible la semana que vengas — nocturna, de naufragio, de deriva, de flotabilidad perfecta (Peak Performance Buoyancy) y de naturalista son las opciones habituales.",
      },
      {
        question: "¿Alguna de estas cuenta para un curso de especialidad?",
        answer:
          "Sí. Cada inmersión de aventura se acredita como la primera inmersión del curso de especialidad correspondiente si decides completarlo.",
      },
    ],
  },
  "rescue-diver": {
    description:
      "Prevención de problemas y habilidades de rescate para buceadores con experiencia.",
    summary:
      "Aprende a detectar los problemas a tiempo — y a manejarlos cuando no se pueden evitar",
    overview:
      "La mayoría de los buceadores describe Rescue como el curso más difícil que han disfrutado. El enfoque se desplaza hacia afuera: de tu propio buceo a los buceadores que te rodean, y a los problemas que aún son lo bastante pequeños para resolverse.\n\nPracticarás el autorrescate, a reconocer y manejar el estrés en otro buceador, el rescate en el agua y los remolques, a llevar a la superficie a un buceador inconsciente y a dar respiraciones de rescate mientras lo traes a la orilla. El curso termina con dos escenarios que lo reúnen todo bajo presión.\n\nSe requiere haber tomado un curso de Emergency First Response (RCP y primeros auxilios) en los últimos 24 meses. Lo impartimos junto con el curso si lo necesitas.",
    durationText: "3 días",
    groupSizeText: "Máximo 8 alumnos por instructor",
    prerequisiteNote:
      "PADI Advanced Open Water Diver o superior — ahí fijamos nosotros este curso, y cubre el requisito de PADI de Adventure Diver con la inmersión de aventura de Underwater Navigation. Si tienes Adventure Diver con navegación, habla con nosotros. También necesitas Emergency First Response de atención primaria y secundaria — o un entrenamiento equivalente de RCP y primeros auxilios — completado en los últimos 24 meses.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Escenarios de rescate y sesiones de habilidades",
      "Tanques, lastre y barco",
    ],
    excludes: ["Curso de Emergency First Response, si lo necesitas", "Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Día 1 — conocimientos y autorrescate",
        items: [
          "Desarrollo de conocimientos y el examen de rescate",
          "Autorrescate y alivio de calambres",
          "Buceador cansado y en pánico en la superficie",
        ],
      },
      {
        title: "Día 2 — rescatar a otro buceador",
        items: [
          "Buceador consciente e inconsciente bajo el agua",
          "Llevar a la superficie a un buceador inconsciente y respiración de rescate en el agua",
          "Salidas del agua, oxígeno y entrega a los servicios de emergencia",
        ],
      },
      {
        title: "Día 3 — escenarios",
        items: [
          "Escenario 1: buceador desaparecido, búsqueda y recuperación",
          "Escenario 2: buceador inconsciente en la superficie, secuencia completa",
          "Repaso final y papeleo de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Rescue Diver exige mucho físicamente?",
        answer:
          "Es el curso recreativo más exigente. Espera mucho trabajo en la superficie, remolques y salidas repetidas del agua. No necesitas ser atleta, pero sí estar razonablemente en forma.",
      },
      {
        question: "¿Necesito entrenamiento en RCP y primeros auxilios?",
        answer:
          "Sí — atención primaria y secundaria de los últimos 24 meses. Si el tuyo venció, impartimos Emergency First Response junto con el curso.",
      },
      {
        question: "¿Esto me habilita para trabajar como buceador?",
        answer:
          "No. Rescue Diver es una certificación recreativa. Divemaster es el primer nivel profesional, y Rescue es su requisito previo.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar — un mínimo, no una garantía. Planea el último día del curso con margen de sobra.",
      },
    ],
  },
  "scuba-refresher": {
    description:
      "Un repaso de medio día para buceadores certificados que llevan tiempo sin bucear.",
    summary: "Quítate el óxido antes de tu primera inmersión de regreso",
    overview:
      "Si ha pasado un año o más desde tu última inmersión, la teoría se olvida más rápido que la diversión. Este es el programa PADI ReActivate: un breve repaso de conocimientos y luego una sesión en aguas confinadas donde te pones el equipo de nuevo y descubres que tus manos todavía saben qué hacer.\n\nRepasamos las habilidades que importan después de una pausa — despejar la máscara, recuperar el regulador, lastre y flotabilidad, compartir aire y cómo funciona tu computadora. Y luego buceas. La mayoría de los buceadores se siente normal otra vez en los primeros diez minutos de la sesión en aguas confinadas.\n\nNo es una certificación nueva. Es un repaso con fecha, anotado en el registro de tu certificación, y es el reinicio ideal antes de subirte a un barco con desconocidos.",
    durationText: "Medio día · unas 4 horas",
    groupSizeText: "Un grupo pequeño, con tu instructor en el agua contigo",
    prerequisiteNote:
      "Pedimos Open Water Diver o superior, de PADI o de otra agencia. ¿Tienes PADI Scuba Diver? Llámanos antes de reservar. Comparte tu registro digital de certificación u otra evidencia, o podemos buscarlo nosotros. Completarás primero un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de que puedas bucear.",
    includes: [
      "Repaso de conocimientos con un instructor",
      "Equipo completo de alquiler para la sesión",
      "Sesión de habilidades en aguas confinadas",
    ],
    excludes: ["Inmersiones posteriores en aguas abiertas", "Fotos y video"],
    scheduleDays: [
      {
        title: "Tu mañana",
        items: [
          "Papeleo, cuestionario médico y ajuste del equipo",
          "Repaso de conocimientos: presión, planificación del aire y computadoras de buceo",
          "Aguas confinadas: despejar la máscara, recuperar el regulador, compartir aire, flotabilidad",
          "Revisión del lastre, repaso final y un plan para tu próxima inmersión",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Cuánto es demasiado tiempo entre inmersiones?",
        answer:
          "No hay una regla. Con seis meses de pausa la mayoría de los buceadores está bien; con un año o más, un repaso vale la mañana. Si tienes dudas, probablemente necesitas uno.",
      },
      {
        question: "¿Obtengo una certificación nueva?",
        answer:
          "No. Tu certificación original nunca vence. ReActivate agrega a tu registro una fecha que indica cuándo te actualizaste por última vez, algo que a algunos operadores les gusta ver.",
      },
      {
        question: "¿Puedo hacerlo el mismo día que una inmersión desde el barco?",
        answer:
          "Muchas veces sí, si damos la sesión por la mañana y buceas por la tarde. Avísanos al reservar para ajustar los días.",
      },
      {
        question: "¿Y si las habilidades no vuelven?",
        answer:
          "Entonces seguimos trabajando, o te indicamos las partes del curso Open Water que vale la pena repetir. A nadie lo suben a un barco antes de estar listo.",
      },
    ],
  },
};
