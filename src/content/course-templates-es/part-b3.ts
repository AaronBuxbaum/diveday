// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplateCopyEs } from "./types";

export const COPY_ES_B3: Record<string, CourseTemplateCopyEs> = {
  "ssi-perfect-buoyancy": {
    description:
      "Domina la posición en el agua, reduce tu consumo de aire y flota sin esfuerzo en cualquier posición.",
    summary: "Perfecciona tu lastre, tu posición y tu aleteo para flotar sin peso",
    overview:
      "Un buen control de flotabilidad es lo que separa a un buceador promedio de uno excelente. El programa de especialidad SSI Perfect Buoyancy te enseña a optimizar tu lastre, equilibrar tu equipo y dominar técnicas de aleteo especializadas.\n\nAprenderás los principios de la flotabilidad y la posición en el agua, cómo determinar con exactitud el lastre que necesitas, y practicarás aleteos avanzados como el aleteo de rana y el giro de helicóptero.\n\nCon dos sesiones de entrenamiento en el agua, reducirás de forma notable tu consumo de aire, protegerás la delicada vida marina y alargarás tus tiempos de inmersión.",
    durationText: "1 día · 2 inmersiones (o alberca + 1 inmersión)",
    groupSizeText: "Grupos pequeños con ajustes personalizados de la posición en el agua",
    prerequisiteNote:
      "Certificación SSI Open Water Diver o superior, al menos 10 años. Se requiere cuestionario médico.",
    includes: [
      "Kit de aprendizaje digital SSI y credencial de certificación",
      "Dos sesiones de entrenamiento de flotabilidad o inmersiones",
      "Tanques y lastre para optimizar el lastre",
    ],
    excludes: ["Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Taller de flotabilidad",
        items: [
          "Cálculos de lastre, distribución del peso y características de flotabilidad del tanque",
          "Inmersión 1: Revisión exacta de flotabilidad, ajustes de posición y posición horizontal del cuerpo",
          "Inmersión 2: Circuitos de obstáculos, flotar en el sitio a distintas profundidades y técnicas de propulsión",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Me ayudará a gastar menos aire?",
        answer:
          "¡Sí! Tener el lastre correcto y nadar en horizontal, en buena posición, reduce de forma notable el arrastre y el esfuerzo, y baja el consumo de gas.",
      },
    ],
  },
  "ssi-deep-diving": {
    description:
      "Aprende los procedimientos y protocolos de seguridad para bucear hasta {depth40}.",
    summary: "Explora con seguridad arrecifes y naufragios más profundos hasta {depth40}",
    overview:
      "Muchos de los sitios de buceo más emocionantes —caídas profundas, pináculos y naufragios históricos— están por debajo de {depth18}. La especialidad SSI Deep Diving te prepara para planificar y realizar inmersiones hasta una profundidad máxima recreativa de {depth40}.\n\nEstudiarás la planificación de inmersiones profundas, el manejo del gas, la teoría de la descompresión, el reconocimiento de la narcosis por nitrógeno, y los procedimientos de parada de seguridad y descompresión de emergencia.\n\nEn tres inmersiones de entrenamiento en aguas abiertas vivirás los efectos de la profundidad, practicarás compartir gas de emergencia a profundidad y te moverás con confianza en ambientes profundos.",
    durationText: "2 días · 3 inmersiones profundas de entrenamiento",
    groupSizeText:
      "Proporción baja de alumnos por instructor para vigilar las inmersiones profundas",
    prerequisiteNote:
      "Certificación Open Water Diver de una agencia reconocida. Edad mínima de 15 años. Se requiere cuestionario médico.",
    includes: [
      "Materiales de aprendizaje digital SSI y credencial de certificación",
      "Tres inmersiones profundas de entrenamiento ({depth30} a {depth40})",
      "Tanques y lastre",
    ],
    excludes: [
      "Computadora de buceo personal (obligatoria en todas las inmersiones profundas)",
      "Alquiler de linterna de buceo",
    ],
    scheduleDays: [
      {
        title: "Día 1: Planificación profunda e inmersiones 1-2",
        items: [
          "Fisiología del buceo profundo, manejo de la narcosis y reglas de consumo de gas",
          "Inmersión 1: Descenso a {depth30}, comparación de computadoras y ejercicio de pérdida de color",
          "Inmersión 2: Navegación a {depth30n}–{depth30}, manejo de la reserva de gas",
        ],
      },
      {
        title: "Día 2: Inmersión profunda 3 y graduación",
        items: [
          "Inmersión 3: Inmersión profunda a {depth40}, parada simulada de descompresión de emergencia y ascenso",
          "Debriefing y registro de la certificación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Cuál es la profundidad máxima a la que puedo bucear después de este curso?",
        answer:
          "Este curso te certifica para bucear hasta el límite máximo recreativo de {depth40} con un compañero de buceo certificado.",
      },
    ],
  },
  "ssi-navigation": {
    description:
      "Aprende a navegar bajo el agua con rumbos de brújula, referencias naturales y patrones.",
    summary:
      "Nunca te pierdas en una inmersión: domina la brújula, los patrones y la navegación natural",
    overview:
      "La navegación submarina es la habilidad que convierte una inmersión ansiosa en una exploración relajada. La especialidad SSI Navigation te enseña a usar una brújula y las referencias naturales submarinas para saber siempre dónde estás y cómo volver al barco o a la orilla.\n\nAprenderás a medir la distancia bajo el agua con ciclos de aleteo y tiempo transcurrido, a navegar patrones de búsqueda complejos y a compensar las corrientes.\n\nEn dos inmersiones en aguas abiertas navegarás rumbos de brújula, practicarás patrones de búsqueda en cuadrado y en triángulo, y volverás con éxito a tu punto de partida.",
    durationText: "1–2 días · 2 inmersiones en aguas abiertas",
    groupSizeText: "Retos de navegación enfocados en la pareja de buceo",
    prerequisiteNote: "Certificación SSI (Junior) Open Water Diver o superior, al menos 10 años.",
    includes: [
      "Kit de aprendizaje digital SSI y credencial de certificación",
      "Dos inmersiones de entrenamiento de navegación",
      "Tanques y lastre",
    ],
    excludes: ["Alquiler o compra de una brújula submarina", "Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Día de navegación",
        items: [
          "Mecánica de la brújula, indicadores naturales de navegación y planificación de patrones de búsqueda",
          "Inmersión 1: Navegación con rumbo recíproco, calibración del ciclo de aleteo y puntos de referencia naturales",
          "Inmersión 2: Patrones de brújula de varios tramos en cuadrado y en triángulo, y ejercicios de reubicación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Necesito mi propia brújula?",
        answer:
          "Tenemos brújulas disponibles para usar en el curso y te recomendamos tener una propia como parte de tu equipo básico de buceo.",
      },
    ],
  },
  "ssi-photo-and-video": {
    description:
      "Aprende técnicas de fotografía y video submarinos para capturar imágenes espectaculares.",
    summary: "Captura fotos y video submarinos nítidos y llenos de color sin dañar el arrecife",
    overview:
      "La fotografía y el video submarinos te permiten compartir la belleza del océano con tus amigos y tu familia. El programa SSI Photo & Video te enseña las técnicas para tomar buenas fotos digitales y video bajo el agua.\n\nAprenderás a preparar el sistema de cámara, el mantenimiento de la carcasa, la posición de los flashes y las luces de video, la composición y los ajustes de balance de blancos en ambientes acuáticos.\n\nEn dos inmersiones de entrenamiento practicarás cómo capturar sujetos macro y gran angular mientras mantienes la flotabilidad neutra y hábitos de buceo que cuidan el arrecife.",
    durationText: "1–2 días · 2 inmersiones",
    groupSizeText: "Grupos pequeños con crítica individual de tus imágenes",
    prerequisiteNote:
      "Certificación Open Water Diver de una agencia reconocida. Edad mínima de 10 años.",
    includes: [
      "Kit de aprendizaje digital SSI y credencial de certificación",
      "Dos inmersiones de entrenamiento de fotografía",
      "Tanques y lastre",
      "Taller de análisis de fotos después de la inmersión",
    ],
    excludes: ["Alquiler de cámara y carcasa", "Tarjetas de memoria", "Software de edición"],
    scheduleDays: [
      {
        title: "Día de taller de fotografía",
        items: [
          "Configuración de la cámara, cuidado de los O-rings de la carcasa, posición de los flashes y óptica submarina",
          "Inmersión 1: Fotografía con flotabilidad neutra, corrección de color y composición en gran angular",
          "Inmersión 2: Técnicas de fotografía de acercamiento y macro",
          "Flujo de trabajo después de la inmersión, consejos de edición y crítica de imágenes",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Puedo usar una cámara de acción como una GoPro?",
        answer:
          "¡Sí! En este curso puedes usar cámaras de acción, cámaras compactas o sistemas sin espejo o réflex.",
      },
    ],
  },
  "ssi-marine-ecology": {
    description:
      "Explora las relaciones complejas entre los organismos marinos y sus hábitats oceánicos.",
    summary: "Entiende los ecosistemas del océano, los arrecifes de coral y la conservación marina",
    overview:
      "Los océanos albergan una biodiversidad increíble y sistemas ecológicos complejos. La especialidad SSI Marine Ecology ofrece una mirada a fondo a la ciencia de la vida oceánica y a los retos que enfrentan hoy los ambientes marinos.\n\nExplorarás los ecosistemas marinos, las redes alimentarias del océano, la biología de los arrecifes de coral, los hábitats costeros y el impacto humano en los océanos. Aprenderás formas prácticas en que los buceadores y los amantes del océano pueden proteger la vida marina.\n\nEs un programa basado en el conocimiento que se puede completar con o sin inmersiones opcionales de experiencia en aguas abiertas.",
    durationText: "1 día (seminarios en seco + inmersiones opcionales)",
    groupSizeText: "Conversaciones interactivas sobre ecología",
    prerequisiteNote:
      "Edad mínima de 10 años. Abierto a buceadores y a quienes no bucean. No se necesitan certificaciones previas para completar la parte teórica.",
    includes: [
      "Materiales de aprendizaje digital SSI y credencial de certificación",
      "Taller interactivo de ecología y conversación de casos de estudio",
    ],
    excludes: [
      "Inmersiones opcionales de ecología marina en aguas abiertas",
      "Equipo de buceo personal",
    ],
    scheduleDays: [
      {
        title: "Seminario de ecología",
        items: [
          "Biodiversidad marina, química del océano y dinámica de las redes alimentarias",
          "Ecosistemas de arrecifes de coral, hábitats de manglar y bosques de kelp",
          "Impactos humanos: cambio climático, acidificación del océano e iniciativas de conservación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Tengo que bucear para completar esta especialidad?",
        answer:
          "No, esta especialidad es un programa de ecología basado en el conocimiento. Las inmersiones son opcionales, pero muy recomendables para ver los principios en acción.",
      },
    ],
  },
  "ssi-react-right": {
    description:
      "Emergency First Response: RCP, primeros auxilios, DEA y administración de oxígeno de emergencia.",
    summary:
      "Aprende habilidades esenciales de RCP, primeros auxilios y administración de oxígeno para emergencias",
    overview:
      "SSI React Right es un programa de capacitación en respuesta a emergencias pensado para buceadores y para quienes no bucean. Adquirirás las habilidades y la confianza para actuar como primer respondiente en emergencias médicas.\n\nEl programa cubre la evaluación primaria, la RCP y la respiración de rescate, el uso del desfibrilador externo automático (DEA), los primeros auxilios y el cuidado de heridas, y la administración de oxígeno de emergencia en emergencias de buceo.\n\nLa práctica de escenarios con las manos en la masa te asegura estar preparado para responder con calma y eficacia durante un accidente.",
    durationText: "1 día (salón en seco y habilidades prácticas)",
    groupSizeText: "Entrenamiento práctico con escenarios médicos",
    prerequisiteNote:
      "Edad mínima de 12 años. No se requiere certificación de buceo previa. Abierto a buceadores y a quienes no bucean.",
    includes: [
      "Materiales de aprendizaje digital SSI React Right y certificación",
      "Entrenamiento práctico con maniquíes de RCP, entrenadores de DEA y sistemas de oxígeno",
      "Entrenamiento con escenarios de primeros auxilios",
    ],
    excludes: ["Mascarilla de bolsillo", "Botiquín de primeros auxilios personal"],
    scheduleDays: [
      {
        title: "Taller de React Right",
        items: [
          "Evaluación primaria y seguridad de la escena",
          "Aplicación práctica de RCP y DEA en maniquíes de adulto",
          "Evaluación secundaria: inmovilización, vendajes y manejo del shock",
          "Armado de la unidad de oxígeno y administración para emergencias de buceo",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Esto cumple el requisito previo de Diver Stress & Rescue?",
        answer:
          "¡Sí! SSI React Right cumple los requisitos previos de RCP, primeros auxilios y oxígeno de emergencia del programa SSI Diver Stress & Rescue.",
      },
    ],
  },
};
