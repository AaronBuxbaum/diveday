// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplateCopyEs } from "./types";

export const COPY_ES_A3: Record<string, CourseTemplateCopyEs> = {
  "underwater-navigator": {
    description: "Tres inmersiones para aprender a encontrar el camino de regreso sin preguntar.",
    summary: "Sabe dónde está el barco y vuelve a él sin salir a la superficie",
    overview:
      "La mayoría de los buceadores navega siguiendo a alguien. Este es el curso donde dejas de hacerlo.\n\nPrimero trabajas con la brújula en la superficie, porque una brújula que todavía te desconcierta a profundidad es una brújula en la que no vas a confiar. Luego vienen tres inmersiones: nadar patrones recíprocos y cuadrados con la brújula, estimar la distancia por ciclos de aleteo y por tiempo, y leer el arrecife mismo — la dirección de la pendiente, la forma en que se alinean las ondulaciones de la arena, dónde está el sol.\n\nLa navegación natural es la mitad que la mayoría de los buceadores se salta y la que funciona cuando la brújula se quedó en el barco. Al final deberías poder salir de un punto fijo, nadar un patrón y volver a él — la misma habilidad que encuentra una línea de fondeo, un naufragio y tu salida.",
    durationText: "1–2 días · 3 inmersiones",
    groupSizeText: "Un grupo pequeño — la navegación se practica de un buceador a la vez",
    prerequisiteNote:
      "PADI Open Water Diver o superior, de PADI o de otra agencia, y tener al menos 10 años. Los buceadores de 10 a 11 años lo toman como Junior Open Water Divers y mantienen su límite de profundidad de {depth12} y los requisitos de supervisión. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Tres inmersiones de entrenamiento",
      "Brújula, pizarra y boyas de marcación",
      "Tanques, lastre y barco",
    ],
    excludes: ["Alquiler de equipo personal", "Una brújula propia, si decides comprar una"],
    scheduleDays: [
      {
        title: "Día 1 — trabajo con la brújula",
        items: [
          "Repaso de conocimientos: la brújula, las referencias naturales y cómo se estima la distancia",
          "En tierra: fijar un rumbo y caminarlo, antes de que te cueste aire",
          "Inmersión 1: rumbos recíprocos de ida y vuelta, solo con la brújula",
          "Inmersión 2: estimar la distancia por ciclos de aleteo, por tiempo y por presión del tanque",
        ],
      },
      {
        title: "Día 2 — patrones y navegación natural",
        items: [
          "Inmersión 3: un patrón cuadrado y luego el regreso al punto de partida solo con referencias naturales",
          "Encontrar un objeto marcado desde la distancia y volver a ubicarlo una segunda vez",
          "Repaso final y papeleo de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Necesito mi propia brújula?",
        answer:
          "No — te damos una para el curso. Si compras una después, compra el modelo con el que te entrenaste siempre que puedas: una brújula que lees sin pensar vale más que una mejor que tienes que estudiar.",
      },
      {
        question: "¿Todo es trabajo con la brújula?",
        answer:
          "Más o menos la mitad. El resto es navegación natural — pendiente, ondulaciones de la arena, luz, dirección del oleaje — a lo que recurres cuando la brújula está en el barco o el sitio no te da nada para alinearte.",
      },
      {
        question: "¿En qué se diferencia de la inmersión de navegación de Advanced Open Water?",
        answer:
          "En la profundidad de la práctica. Aquella es una inmersión y una introducción; esta son tres inmersiones de patrones y estimación de distancia hasta que sea repetible. La primera inmersión aquí se acredita como la inmersión de aventura de Navegación, en cualquier dirección.",
      },
      {
        question: "¿Y si me pierdo durante el curso?",
        answer:
          "Te vas a perder, al menos una vez, y de eso se trata hacerlo con un instructor a tu lado. Equivocarte frente a tu instructor sale mucho más barato que equivocarte en una inmersión de vacaciones.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
  "digital-underwater-photographer": {
    description:
      "Dos inmersiones para lograr una foto que valga la pena guardar, en el agua y no en el software.",
    summary: "Regresa con fotos que de verdad quieras enseñar",
    overview:
      "Casi todas las primeras fotos submarinas son iguales: azules, suaves y tomadas desde demasiado lejos. Casi todo eso viene de tres hábitos, y dos inmersiones bastan para romperlos.\n\nAprenderás a acercarte y luego a acercarte más, a disparar ligeramente hacia arriba en lugar de hacia abajo sobre la arena, y a devolverle luz a la imagen — con estroboscopio, luz de video o simplemente el sol a tu espalda — porque el agua le quita el rojo a todo lo que está a más de unos pocos largos de cuerpo. Configuramos tu cámara juntos antes de que te mojes, para que no estés recorriendo menús a profundidad.\n\nLa flotabilidad es la otra mitad de este curso y no es opcional. Un fotógrafo que se arrodilla en el arrecife para estabilizar una toma es un buceador que hace daño; aquí cada foto se toma en suspensión.",
    durationText: "1 día · 2 inmersiones",
    groupSizeText:
      "Un grupo pequeño, para que tu instructor pueda repasar tus fotos entre inmersiones",
    prerequisiteNote:
      "PADI Open Water Diver o superior, de PADI o de otra agencia, y tener al menos 10 años. Los buceadores de 10 a 11 años lo toman como Junior Open Water Divers y mantienen su límite de profundidad de {depth12} y los requisitos de supervisión. Aquí importa más una flotabilidad estable que cualquier cámara. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Dos inmersiones de entrenamiento",
      "Una cámara con carcasa prestada, si no tienes una",
      "Tanques, lastre y barco",
    ],
    excludes: ["Alquiler de equipo personal", "Tarjetas de memoria", "Software de edición"],
    scheduleDays: [
      {
        title: "Día del curso",
        items: [
          "Preparación: tu cámara, su carcasa y los pocos ajustes que realmente vas a usar",
          "Inmersión 1: acercarte, disparar ligeramente hacia arriba y mantener la posición sin tocar nada",
          "Intervalo en superficie: repasar tus propias fotos con tu instructor, con honestidad",
          "Inmersión 2: luz y color — estroboscopio o luz de video, ángulo y distancia",
          "Elegir tus mejores fotos y averiguar por qué las demás no salieron",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Necesito tener una cámara?",
        answer:
          "No, podemos prestarte una. Si tienes una, tráela — la carcasa, los botones y los menús son la mitad de lo que aprendes aquí, y son distintos en cada cámara.",
      },
      {
        question: "¿Sirve un teléfono?",
        answer:
          "En una carcasa clasificada para la profundidad a la que vas a bucear, sí, y se toman muchas buenas fotos así. Trae la carcasa que de verdad piensas usar, no una que nunca has abierto.",
      },
      {
        question: "¿Qué tan buena debe ser mi flotabilidad?",
        answer:
          "Lo bastante buena para mantenerte suspendido y lejos del arrecife con las dos manos en una cámara. Si todavía no llegas ahí, tomar primero Peak Performance Buoyancy hará más por tus fotos que cualquier lente.",
      },
      {
        question: "¿Y el video?",
        answer:
          "Los hábitos se transfieren directamente — acércate, quédate quieto, ilumina el sujeto — pero este curso está pensado para fotos fijas. Si lo que te interesa es el video, dínoslo al reservar y daremos ese enfoque a las inmersiones.",
      },
      {
        question: "¿Esto cuenta para Advanced Open Water?",
        answer:
          "Sí. La primera inmersión se acredita como la inmersión de aventura de Digital Underwater Photographer en el curso Advanced Open Water Diver, en cualquier dirección.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
  "drift-diver": {
    description: "Dos inmersiones para aprender a dejar que la corriente haga el trabajo.",
    summary: "Deja de nadar contra el océano y empieza a viajar con él",
    overview:
      "Una inmersión de deriva es el buceo bueno más relajado que existe. Entras, dejas de aletear y dejas que el agua te lleve frente a más arrecife del que podrías nadar jamás. Lo que añade el curso es todo lo que la rodea: mantenerse juntos y mantenerse localizables.\n\nDos inmersiones cubren lo que suele salir mal. Las entradas tienen que ser rápidas y todos tienen que ir a la vez. El contacto con el compañero importa más cuando nada queda donde lo dejaste. Se sube una boya de superficie antes de que subas tú, para que el barco sepa dónde estás antes de que aparezca tu cabeza. También aprenderás a leer una corriente — dónde se acelera, dónde hace remolinos detrás de las estructuras y cómo salir de una en la que preferirías no estar.\n\nLa mayoría de los días de deriva aquí son con barco libre: nada se ancla, el barco sigue tus burbujas y tu boya, y te recoge donde salgas.",
    durationText: "1 día · 2 inmersiones",
    groupSizeText:
      "Un grupo pequeño — un grupo de deriva muy estirado es un grupo que nadie puede vigilar",
    prerequisiteNote:
      "PADI Open Water Diver o superior, de PADI o de otra agencia, y tener al menos 12 años. Los buceadores de 12 a 14 años se certifican como Junior Drift Divers y mantienen los requisitos de supervisión que acompañan a su certificación. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Dos inmersiones de deriva desde el barco",
      "Boya de marcación de superficie y carrete",
      "Tanques, lastre y barco",
    ],
    excludes: [
      "Alquiler de equipo personal",
      "Una boya de marcación propia, si decides comprar una",
    ],
    scheduleDays: [
      {
        title: "Día del curso",
        items: [
          "Charla previa: leer una corriente, el procedimiento con barco libre y lo que la tripulación espera ver",
          "Inmersión 1: una entrada rápida en grupo, derivar con buen trimado y mantener el contacto con el compañero",
          "Intervalo en superficie, y una mirada honesta a cómo se mantuvo unido el grupo",
          "Inmersión 2: desplegar una boya de superficie desde la profundidad y luego un ascenso controlado en agua en movimiento",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Es una inmersión de deriva más difícil que una inmersión normal?",
        answer:
          "Más fácil para las piernas y más difícil para la atención. Nada se queda donde lo dejaste, así que el contacto con el compañero y el despliegue de la boya dejan de ser trámites y se vuelven la inmersión.",
      },
      {
        question: "¿Y si me separo del grupo?",
        answer:
          "Asciende, despliega tu boya y espera. El barco sigue al grupo en lugar de estar sobre un ancla, y un buceador con una boya arriba se ve desde muy lejos. Lo ensayamos en lugar de confiar en la suerte.",
      },
      {
        question: "¿Necesito mi propia boya de superficie?",
        answer:
          "Te damos una para el curso. Compra la tuya después — una boya que has lanzado una docena de veces sube limpia el día que importa.",
      },
      {
        question: "¿Puedo tomar fotos en una inmersión de deriva?",
        answer:
          "Sí, y te enseñará a disparar rápido. Lo que no puedes hacer es detenerte a encuadrar una toma; el grupo no se detendrá contigo.",
      },
      {
        question: "¿Esto cuenta para Advanced Open Water?",
        answer:
          "Sí. La primera inmersión se acredita como la inmersión de aventura de Deriva en el curso Advanced Open Water Diver, en cualquier dirección.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
  "boat-diver": {
    description: "Dos inmersiones para ser útil, y estar tranquilo, en un barco de buceo.",
    summary: "Sabe dónde va tu equipo, dónde pararte y cuándo saltar",
    overview:
      "Nadie nace sabiendo cómo funciona un barco de buceo. Todo es desconocido la primera vez: dónde va tu equipo, por qué lado se entra, qué quiere decir la tripulación con una caída en vivo, por qué las aletas se ponen al final.\n\nDos inmersiones cubren la rutina. Armarte en el espacio que te dan y no en el que quisieras. Las entradas que pide un barco, hechas sin perder la máscara. Cabos de referencia y cabos de descenso, y para qué sirven en realidad. Volver a subir a una escalera con oleaje sin lastimarte ni lastimar a quien viene detrás. También aprenderás el vocabulario — proa, popa, barlovento, y qué partes de una charla previa son instrucciones y no decoración.\n\nEl mareo tiene su propia conversación, porque la respuesta honesta es que es mucho más fácil de prevenir que de curar.",
    durationText: "1 día · 2 inmersiones",
    groupSizeText:
      "Un grupo pequeño en un día de barco normal, no en un barco fletado para el curso",
    prerequisiteNote:
      "PADI Open Water Diver o superior, de PADI o de otra agencia, y tener al menos 10 años. Los buceadores de 10 a 11 años lo toman como Junior Open Water Divers y mantienen su límite de profundidad de {depth12} y los requisitos de supervisión. Completarás un cuestionario médico antes del curso; algunas respuestas requieren la autorización de un médico antes de que puedas bucear, así que avísanos pronto si eso puede aplicarte.",
    includes: [
      "Todos los materiales de aprendizaje y las tarifas de certificación de PADI",
      "Dos inmersiones desde el barco",
      "Tanques, lastre y el día de barco",
    ],
    excludes: [
      "Alquiler de equipo personal",
      "Medicamento para el mareo",
      "Propina para la tripulación",
    ],
    scheduleDays: [
      {
        title: "Día del curso",
        items: [
          "En el muelle: cargar, estibar y armarte en el espacio que tienes",
          "En marcha: la charla previa, el pase de lista y lo que la tripulación necesita de ti",
          "Inmersión 1: entrada de zancada, descenso por el cabo y salida por la escalera",
          "Inmersión 2: entrada de espaldas, trabajo con el cabo de referencia y una salida cronometrada con el oleaje",
          "De vuelta en el muelle: enjuagar, descargar y el registro de inmersiones",
        ],
      },
    ],
    faqs: [
      {
        question: "Me mareo. ¿Aun así debería hacerlo?",
        answer:
          "Sí, y avísanos antes del día. El medicamento tomado la noche anterior funciona mucho mejor que cualquier cosa que tomes cuando ya lo sientes, y la tripulación puede ponerte donde el barco se mueva menos.",
      },
      {
        question: "¿Qué entrada me van a pedir hacer?",
        answer:
          "La que pida la distribución del barco — normalmente una zancada, a veces una entrada de espaldas desde un tubo bajo. Practicas las dos aquí, así que ninguna es una sorpresa en el barco de otro.",
      },
      {
        question: "¿Solo sirve en su barco?",
        answer:
          "No. Los barcos cambian; la secuencia no. Estibar, armarte, escuchar la charla, entrar, hacer el plan de la inmersión, salir y contar a todos. Se aplica en un crucero de buceo, en una panga y en un charter en un idioma que no hablas.",
      },
      {
        question: "¿Esto cuenta para Advanced Open Water?",
        answer:
          "Sí. La primera inmersión se acredita como la inmersión de aventura de Barco en el curso Advanced Open Water Diver, en cualquier dirección.",
      },
      {
        question: "¿Puedo volar después?",
        answer:
          "Espera al menos 18 horas después de varias inmersiones antes de volar. Es un mínimo, no una garantía — planea tu último día de buceo con margen de sobra.",
      },
    ],
  },
};
