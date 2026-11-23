// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplateCopyEs } from "./types";

export const COPY_ES_C2: Record<string, CourseTemplateCopyEs> = {
  "sdi-computer-nitrox-diver": {
    description:
      "Tiempos de fondo más largos con aire enriquecido, planeados con tu propia computadora.",
    summary: "Más tiempo en el arrecife, menos tiempo esperando en la superficie",
    overview:
      "El aire enriquecido tiene más oxígeno y menos nitrógeno, lo que significa límites sin descompresión más largos a las profundidades en las que realmente se bucea en esta costa. En una mañana de dos tanques, suele ser la diferencia entre una segunda inmersión apresurada y una sin prisas.\n\nSDI lo enseña como lo vas a bucear: con una computadora configurada para la mezcla, no con un segundo juego de tablas impresas. Aprenderás qué hace la mezcla, cuáles son los límites de oxígeno y por qué importan, y cómo analizar y registrar tú mismo cada tanque antes de que vaya a tu espalda.\n\nAnalizar tu propio gas no es una formalidad. Es la única revisión que nadie más puede hacer por ti.",
    durationText: "Un día · teoría más dos inmersiones opcionales",
    groupSizeText: "Grupos pequeños alrededor del analizador",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o una certificación equivalente de otra agencia. Tener al menos 10 años; los menores de 18 necesitan el consentimiento de un padre o tutor. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Materiales digitales y tarjeta de certificación de SDI",
      "Uso del analizador y práctica de registro de tanques",
      "Dos inmersiones con aire enriquecido, si eliges la opción en el agua",
    ],
    excludes: ["Recargas de aire enriquecido después del curso", "Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Computer Nitrox Diver",
        items: [
          "Qué cambia la mezcla y qué no",
          "Límites de exposición al oxígeno y el techo de profundidad que implica tu mezcla",
          "Analizar, etiquetar y registrar un tanque — siempre",
          "Configurar tu computadora para la mezcla y dos inmersiones con ella",
        ],
      },
    ],
    faqs: [
      {
        question: "¿El aire enriquecido me deja bucear más profundo?",
        answer:
          "No — al contrario. Una mezcla más rica tiene un techo menos profundo por la exposición al oxígeno. Lo que te da es tiempo a las profundidades en las que ya buceas.",
      },
    ],
  },
  "sdi-deep-diver": {
    description: "Planea, maneja y disfruta el extremo más profundo del buceo recreativo.",
    summary: "Los naufragios y paredes que empiezan donde termina el arrecife",
    overview:
      "Por debajo de {depth30} todo cambia: la luz se aplana, el gas desaparece más rápido de lo que el manómetro parece indicar y la narcosis llega con tanta discreción que no la notarás si no has practicado a notarla.\n\nEste curso trata de planear para las tres cosas. Manejo del gas con una reserva real, perfiles de ascenso a los que te comprometes antes de descender y una mirada franca a cómo te comportas tú personalmente en profundidad.\n\nEs lo que exigen los naufragios más profundos y la pared exterior, y es donde la mayoría de los buceadores por fin se sincera sobre su consumo de aire.",
    durationText: "Dos días · cuatro inmersiones",
    groupSizeText: "Grupos pequeños, porque la profundidad acorta la inmersión de todos",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o equivalente. Tener al menos 10 años; los menores de 18 necesitan el consentimiento de un padre o tutor; aplican límites de profundidad para menores: {depth12} a los 10–11 años y {depth18} a los 12–14 ({depth21} con una certificación avanzada), así que su plan se queda corto de las inmersiones más profundas. Se recomienda mucho el entrenamiento en aire enriquecido para las inmersiones más profundas. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Cuatro inmersiones de entrenamiento cada vez más profundas",
      "Tanques, plomos y una línea de descompresión con gas de contingencia",
    ],
    excludes: ["Recargas de aire enriquecido", "Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Día uno — planeación y las dos primeras inmersiones",
        items: [
          "Planeación del gas, reservas y presiones de retorno que de verdad respetas",
          "Narcosis: reconocerla en ti y en tu compañero",
          "Dos inmersiones que ganan profundidad con un ascenso controlado y planeado",
        ],
      },
      {
        title: "Día dos — el par más profundo",
        items: [
          "Dos inmersiones hacia el límite recreativo, con un plan de contingencia explicado en el briefing",
          "Debriefing: tasas de consumo, tiempos y qué cambiarías",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Hasta qué profundidad me lleva?",
        answer:
          "Hasta {depth40}, el límite recreativo, para adultos; {depth12} a los 10–11 años y {depth18} a los 12–14 ({depth21} con una certificación avanzada). Más allá de eso es buceo técnico, que es otra ruta de entrenamiento con otro equipo.",
      },
    ],
  },
  "sdi-underwater-navigation": {
    description: "Sabe dónde estás y vuelve al barco sin salir a la superficie a revisar.",
    summary: "Referencias naturales, brújula y cómo volver a encontrar la línea del fondeo",
    overview:
      "La navegación es la habilidad que en silencio mejora todas las demás inmersiones. Un buceador que sabe dónde está el barco pasa la inmersión mirando el arrecife en lugar de la superficie.\n\nAprenderás a leer el arrecife mismo — contornos de profundidad, dirección de las ondulaciones, cómo cae la luz — y a respaldarlo con una brújula cuando la visibilidad se cierra. Después harás patrones: ida y vuelta, cuadrados y los de forma de búsqueda que importan cuando algo se pierde.\n\nAl final serás a quien sigue el grupo.",
    durationText: "Un día · dos inmersiones",
    groupSizeText: "Grupos pequeños, cada buceador haciendo sus propios patrones",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o una certificación equivalente de otra agencia. Tener al menos 10 años; los menores de 18 necesitan el consentimiento de un padre o tutor. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Dos inmersiones de navegación",
      "Brújula y pizarra",
    ],
    excludes: ["Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Underwater Navigation",
        items: [
          "Navegación natural: contornos, ondulaciones, luz y dirección del oleaje",
          "Trabajo con brújula: rumbos, rumbos recíprocos y distancia por ciclo de aleteo",
          "Inmersión uno: patrones de ida y vuelta y en cuadrado",
          "Inmersión dos: navegar a un objetivo y volver a la línea",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Basta con una brújula?",
        answer:
          "Pocas veces. La brújula te da un rumbo; el arrecife te da la posición. Este curso enseña ambas porque cada una cubre lo que la otra no ve.",
      },
    ],
  },
  "sdi-night-limited-visibility-diver": {
    description: "El mismo arrecife de noche, y las habilidades para cuando el agua se pone verde.",
    summary: "Un arrecife totalmente distinto cuando se va el sol",
    overview:
      "El arrecife cambia de turno al atardecer. Los peces loro se envuelven en moco y duermen, los pulpos salen a cazar y los pólipos del coral se abren en algo que el día nunca te muestra.\n\nAprenderás disciplina con la luz — hacia dónde apuntar la linterna y, más importante, hacia dónde no —, las señales que sustituyen a los gestos con las manos en la oscuridad y cómo no perderte: con tu compañero, con el grupo y con el barco.\n\nLas mismas habilidades sirven con poca visibilidad de día, que en esta costa es el motivo más común para necesitarlas.",
    durationText: "Dos noches · dos a tres inmersiones",
    groupSizeText: "Grupos pequeños — nadie bucea fuera de la luz de las linternas",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o una certificación equivalente de otra agencia. Tener al menos 10 años; los menores de 18 necesitan el consentimiento de un padre o tutor. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Linternas principal y de respaldo",
      "De dos a tres inmersiones de noche",
    ],
    excludes: ["Alquiler de equipo personal", "Iluminación para fotografía"],
    scheduleDays: [
      {
        title: "Buceo nocturno y con visibilidad limitada",
        items: [
          "Manejo de la linterna, señales de luz y cómo marcar la línea y el barco",
          "Entradas, descensos y cómo mantenerse juntos en la oscuridad",
          "Inmersiones: navegación con linterna y lo que sale después de la puesta del sol",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Y si me falla la linterna?",
        answer:
          "Llevas una de respaldo, y el curso practica la falla antes de que ocurra. Perder la luz es un inconveniente que ya practicaste, no una emergencia.",
      },
    ],
  },
  "sdi-wreck-diver": {
    description:
      "Explora un naufragio como se debe y entiende exactamente dónde termina el exterior.",
    summary: "Cómo bucear un naufragio como una estructura, no solo pasar nadando junto a él",
    overview:
      "Un naufragio es un edificio que cayó al mar, y recompensa que lo leas como tal. Aprenderás a reconocerlo de afuera hacia adentro: orientación, la corriente que corre sobre él y a su alrededor, dónde se juntan los peces y qué aberturas son tan atractivas como peligrosas.\n\nEste es un curso recreativo de naufragios. Cubre los peligros de los entornos con techo y cómo reconocer la línea que no se cruza — enredos, nubes de sedimento y el hecho de que un techo significa que la superficie ya no está sobre ti.\n\nLo que obtienes es la confianza para bucear bien nuestros naufragios y el criterio para saber qué seguiría exigiendo un curso de penetración.",
    durationText: "Dos días · cuatro inmersiones",
    groupSizeText: "Grupos pequeños, porque en un naufragio es fácil perder gente",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o equivalente. Tener al menos 15 años; los menores de 18 necesitan el consentimiento de un padre o tutor: las inmersiones en la zona de luz son de penetración limitada, que SDI abre a los 15. La versión sin penetración de SDI empieza a los 10 y mantiene a los buceadores más jóvenes dentro de {depth12} a los 10–11 y {depth18} a los 12–14; pregúntanos si eso le conviene a un buceador más joven. Nuestros naufragios están lo bastante profundos como para que convenga tener antes el entrenamiento de profundidad. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Cuatro inmersiones de naufragio",
      "Carretes, líneas y luces para el curso",
    ],
    excludes: ["Alquiler de equipo personal", "Recargas de aire enriquecido"],
    scheduleDays: [
      {
        title: "Día uno — leer la estructura",
        items: [
          "Historia del naufragio, orientación y los peligros que acumula un casco",
          "Dos inmersiones: explorar el exterior y trazar un mapa de lo que encontraste",
        ],
      },
      {
        title: "Día dos — líneas, sedimento y criterio",
        items: [
          "Técnica de carrete y línea, y un aleteo que no arruine la visibilidad",
          "Dos inmersiones en las aberturas y una mirada honesta a dónde termina lo recreativo",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Voy a entrar al naufragio?",
        answer:
          "No más allá de la zona de luz. Este curso te enseña a bucear un naufragio bien desde afuera y a entender qué te exigiría todavía el entrenamiento de penetración completa.",
      },
    ],
  },
  "sdi-drift-diver": {
    description:
      "Deja que la corriente haga el trabajo y sigue siendo fácil de encontrar mientras tanto.",
    summary: "El buceo más fácil que hay, cuando dejas de pelear con el agua",
    overview:
      "Una inmersión de corriente es el buceo más relajado y a menudo el mejor de esta costa: te dejas caer al agua, la corriente te lleva a lo largo del arrecife y el barco sigue tus burbujas.\n\nLas habilidades tratan de ser fácil de encontrar y de mantenerse juntos. Entradas coordinadas con el grupo, una flotabilidad que sostiene la línea sin aletear, desplegar una boya de superficie desde la profundidad y la disciplina de ascender en grupo en lugar de como cinco sorpresas distintas para el capitán.\n\nLos buceadores que lo toman dejan de temerle a la corriente y empiezan a elegirla.",
    durationText: "Un día · dos inmersiones",
    groupSizeText: "Grupos pequeños que el barco puede mantener en un mismo trozo de agua",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o una certificación equivalente de otra agencia. Tener al menos 10 años; los menores de 18 necesitan el consentimiento de un padre o tutor. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Dos inmersiones de corriente",
      "Boya de marcación de superficie y carrete",
    ],
    excludes: ["Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Drift Diver",
        items: [
          "Leer la corriente, planear una inmersión de corriente con barco que sigue y entradas negativas",
          "Desplegar una boya de superficie desde la profundidad sin subir con ella",
          "Dos inmersiones de corriente, ascenso y salida a la superficie como un solo grupo",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Qué pasa si me separo del grupo?",
        answer:
          "Despliegas tu boya y sales a la superficie — justo lo que practica el curso. El barco sigue las boyas, así que un ascenso en solitario es una recogida y no una búsqueda.",
      },
    ],
  },
  "sdi-boat-diver": {
    description: "Sé el buceador que un capitán se alegra de tener a bordo.",
    summary: "Entradas, salidas y saber dónde poner tu equipo",
    overview:
      "Casi todas las inmersiones de esta costa empiezan en un barco, y un barco es un espacio pequeño con horario. Los buceadores que lo hacen fácil son los que saben dónde va su equipo, cuándo estar listos y cómo entrar y salir del agua sin retrasar a otras once personas.\n\nCubrirás el vocabulario que un briefing da por sabido, entradas y salidas con un poco de oleaje, tableros de etiquetas y pases de lista, y qué hacer cuando sales a la superficie detrás del barco y no a un lado.\n\nNo es un curso glamoroso. Es el que mejora cada salida que reserves en tu vida.",
    durationText: "Un día · dos inmersiones",
    groupSizeText: "Grupos pequeños a bordo de una salida de trabajo real",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o una certificación equivalente de otra agencia. Tener al menos 10 años; los menores de 18 necesitan el consentimiento de un padre o tutor. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Dos inmersiones desde barco",
      "Tanques y lastre",
    ],
    excludes: ["Alquiler de equipo personal", "Remedios para el mareo"],
    scheduleDays: [
      {
        title: "Boat Diver",
        items: [
          "Vocabulario del barco, dónde guardar el equipo y dónde no pararse",
          "Paso de gigante, voltereta hacia atrás y volver a subir por la escalera con oleaje",
          "Pases de lista, tableros de etiquetas y el problema de salir detrás del barco",
        ],
      },
    ],
    faqs: [
      {
        question: "Me mareo. ¿Es mala idea?",
        answer:
          "Avísanos al reservar. Los remedios funcionan mucho mejor tomados la noche anterior que en el agua, y dónde te sientas y qué miras importan más de lo que la gente espera.",
      },
    ],
  },
};
