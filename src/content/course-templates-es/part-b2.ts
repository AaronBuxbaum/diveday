// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplateCopyEs } from "./types";

export const COPY_ES_B2: Record<string, CourseTemplateCopyEs> = {
  "underwater-naturalist": {
    description:
      "Mira más allá de los animales grandes y descubre las interacciones y los ecosistemas del arrecife.",
    summary: "Mira la vida acuática con ojos de ecólogo y de observador de conducta",
    overview:
      "En lugar de ver solo un pez o una cabeza de coral, aprende a ver las relaciones complejas que hacen prosperar los ecosistemas submarinos. El curso Underwater Naturalist te enseña a identificar grupos de organismos marinos, entender las relaciones simbióticas y observar el comportamiento sin molestar a la vida acuática.\n\nAprenderás los grandes grupos de vida acuática, las cadenas alimentarias, los hábitats y el papel que tienen los buceadores en la protección de los frágiles ambientes submarinos.\n\nEn dos inmersiones en aguas abiertas observarás relaciones simbióticas, practicarás técnicas de buceo que no destruyen y identificarás organismos y sus hábitats.",
    durationText: "1 día · 2 inmersiones",
    groupSizeText: "Grupos pequeños enfocados en la observación guiada del arrecife",
    prerequisiteNote:
      "PADI (Junior) Open Water Diver o superior, al menos 10 años. Se requiere cuestionario médico.",
    includes: [
      "Materiales de aprendizaje PADI y tarifa de certificación",
      "Dos inmersiones de entrenamiento de naturalista en aguas abiertas",
      "Pizarras submarinas y guías de identificación",
      "Tanques y lastre",
    ],
    excludes: ["Alquiler de equipo personal"],
    scheduleDays: [
      {
        title: "Día de naturalista",
        items: [
          "Briefing: ecosistemas acuáticos, simbiosis, relaciones entre depredador y presa, y conservación",
          "Inmersión 1: Identificar grupos de plantas e invertebrados y relaciones de mutualismo",
          "Debriefing en superficie: comparar observaciones y consultar las pizarras de identificación",
          "Inmersión 2: Conductas de los vertebrados, estrategias de alimentación y camuflaje",
        ],
      },
    ],
    faqs: [
      {
        question: "¿En qué se diferencia de Fish Identification?",
        answer:
          "Fish Identification se enfoca en identificar especies y familias. Underwater Naturalist mira más amplio: ecosistemas marinos completos, redes alimentarias, invertebrados y simbiosis.",
      },
    ],
  },
  "ssi-try-scuba": {
    description:
      "Tu primera probada de respirar bajo el agua, bajo el cuidado directo de un instructor SSI.",
    summary: "Vive el buceo por primera vez en aguas confinadas con un instructor SSI",
    overview:
      "SSI Try Scuba es tu introducción al mundo submarino. Bajo la supervisión directa de un profesional SSI, aprenderás las normas básicas de seguridad y las habilidades necesarias para bucear.\n\nVivirás lo que se siente respirar bajo el agua en una alberca o en un entorno de aguas confinadas tranquilas. Tu instructor te guiará paso a paso en el conocimiento del equipo y en las habilidades fundamentales del buceo.\n\nSi decides continuar tu formación, tu experiencia de Try Scuba puede acreditarse para tu certificación SSI Scuba Diver u Open Water Diver.",
    durationText: "Medio día (aprox. 3–4 horas)",
    groupSizeText: "Supervisión directa del instructor, 1:1 o en grupo pequeño",
    prerequisiteNote:
      "Edad mínima de 8 años para alberca o aguas confinadas (10 para la inmersión opcional en aguas abiertas). No se necesita experiencia previa de buceo. Se requiere cuestionario médico antes de entrar al agua.",
    includes: [
      "Credencial digital de reconocimiento SSI y materiales de aprendizaje",
      "Alquiler del equipo de buceo completo",
      "Sesión en alberca o aguas confinadas con un instructor SSI",
    ],
    excludes: ["Traje de baño y toalla", "Inmersión opcional adicional en aguas abiertas"],
    scheduleDays: [
      {
        title: "Sesión de Try Scuba",
        items: [
          "Briefing: resumen del equipo, compensación, reglas de respiración y señas manuales submarinas",
          "Ajuste del equipo y entrada a la alberca o aguas confinadas",
          "Primeras respiraciones bajo el agua, y práctica de despeje del regulador y de la máscara",
          "Nado divertido y práctica de flotabilidad bajo la supervisión directa del instructor",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Try Scuba es una certificación?",
        answer:
          "No, es una experiencia introductoria sin certificación. Sin embargo, las habilidades que aprendes pueden contar para tu curso SSI Open Water Diver.",
      },
    ],
  },
  "ssi-open-water-diver": {
    description:
      "La certificación SSI de reconocimiento mundial para bucear de forma independiente con un compañero.",
    summary: "Obtén tu certificación de buceo mundial y de por vida para bucear hasta {depth18}",
    overview:
      "El programa SSI Open Water Diver es tu puerta para explorar el océano en todo el mundo. Con aprendizaje digital, entrenamiento en alberca e inmersiones en aguas abiertas, adquirirás los conocimientos y las habilidades para bucear con seguridad hasta {depth18} con un compañero certificado.\n\nLa metodología de entrenamiento de SSI se centra en la comodidad por repetición. Dominarás el armado del equipo, el despeje de la máscara, la recuperación del regulador, el control de flotabilidad y los procedimientos de emergencia en aguas confinadas antes de completar cuatro inmersiones de entrenamiento en aguas abiertas.\n\nAl graduarte, tu certificación digital es reconocida internacionalmente y no caduca.",
    durationText: "3–4 días · 6 sesiones confinadas + 4 inmersiones en aguas abiertas",
    groupSizeText: "Proporción baja de alumnos por instructor para mayor seguridad y comodidad",
    prerequisiteNote:
      "Edad mínima de 10 años (certificado como Junior Open Water Diver hasta los 15 años). Poder nadar 200 metros/yardas de forma continua y flotar o mantenerte a flote 10 minutos. Se requiere cuestionario médico.",
    includes: [
      "Kit de aprendizaje digital SSI, video y credencial digital de certificación de por vida",
      "Sesiones de entrenamiento en alberca o aguas confinadas",
      "Cuatro inmersiones de entrenamiento en aguas abiertas",
      "Tanques, lastre y alquiler de equipo completo durante el curso",
      "Integración de la bitácora mediante la app MySSI",
    ],
    excludes: ["Máscara y snorkel personales (recomendados)", "Transporte a los sitios de buceo"],
    scheduleDays: [
      {
        title: "Día 1: Teoría y entrenamiento en alberca",
        items: [
          "Repaso de teoría y examen digital",
          "Armado y desarmado del equipo, y revisiones de seguridad previas a la inmersión",
          "Habilidades en aguas confinadas: respiración, despeje del regulador y despeje de la máscara",
        ],
      },
      {
        title: "Día 2: Dominio en alberca y ejercicios con el equipo",
        items: [
          "Flotabilidad neutra, giros con las aletas y práctica de flotar en el sitio",
          "Ejercicios de emergencia por falta de aire, compartir la fuente de aire alterna y ascensos de emergencia",
          "Prueba de nado de 200 metros/yardas y flotación de supervivencia de 10 minutos",
        ],
      },
      {
        title: "Día 3: Inmersiones 1 y 2 en aguas abiertas",
        items: [
          "Inmersión 1: Descenso a {depth12}, ajuste de flotabilidad y exploración guiada",
          "Inmersión 2: Quitarte y volver a ponerte la máscara, recuperación del regulador y ascenso controlado",
        ],
      },
      {
        title: "Día 4: Inmersiones 3 y 4 en aguas abiertas y certificación",
        items: [
          "Inmersión 3: Descenso a {depth18}, flotar en el sitio con flotabilidad neutra y remolque de compañero",
          "Inmersión 4: Planificación de la inmersión a cargo del alumno, navegación submarina y graduación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿A qué profundidad puedo bucear al graduarme?",
        answer:
          "Los SSI Open Water Divers de 15 años o más están calificados para bucear hasta {depth18}. Los buceadores de 10 a 11 años tienen una profundidad máxima de {depth12}, y los de 12 a 14 años pueden bucear hasta {depth18} con un buceador adulto certificado.",
      },
      {
        question: "¿La certificación caduca?",
        answer:
          "No, tu certificación SSI Open Water Diver es válida de por vida. Si llevas mucho tiempo sin bucear, se recomienda un Scuba Skills Update.",
      },
    ],
  },
  "ssi-advanced-adventurer": {
    description:
      "Prueba cinco áreas de especialidad distintas y amplía tu profundidad a {depth30}.",
    summary:
      "Prueba 5 inmersiones de especialidad, sube tu límite de profundidad a {depth30} y afina tus habilidades",
    overview:
      "Si quieres explorar nuevos estilos de buceo e ir más profundo, el programa SSI Advanced Adventurer te permite probar cinco programas de especialidad SSI distintos sin comprometerte con las certificaciones de especialidad completas.\n\nHarás cinco inmersiones de aventura, entre ellas las obligatorias de Deep Diving (hasta {depth30}) y de navegación submarina, más tres inmersiones electivas como Perfect Buoyancy, nocturna o de visibilidad limitada, o de naufragios.\n\nCada inmersión se acredita para su certificación de especialidad SSI completa si decides hacerla más adelante.",
    durationText: "2–3 días · 5 inmersiones de aventura",
    groupSizeText: "Grupos pequeños a la medida de la exploración de especialidades",
    prerequisiteNote:
      "SSI Open Water Diver o equivalente de una agencia reconocida. Edad mínima de 10 años para las electivas someras (12 años para Deep Diving hasta {depth21}, 15 años para {depth30}).",
    includes: [
      "Materiales de aprendizaje digital SSI y credencial de certificación",
      "Cinco inmersiones de aventura de especialidad",
      "Tanques, lastre y recargas de aire",
    ],
    excludes: [
      "Alquiler de equipo personal",
      "Alquiler de equipo de especialidad (linternas, brújulas, etc.)",
    ],
    scheduleDays: [
      {
        title: "Día 1: Navegación y flotabilidad",
        items: [
          "Briefing sobre los temas de especialidad y la planificación de la inmersión",
          "Inmersión 1: Navegación submarina (rumbos de brújula, rumbos recíprocos, referencias naturales)",
          "Inmersión 2: Perfect Buoyancy (optimizar la posición en el agua, aleteo, flotar en el sitio)",
        ],
      },
      {
        title: "Día 2: Inmersión profunda y electivas",
        items: [
          "Inmersión 3: Deep Diving (descenso a {depth30}, conciencia del nitrógeno, consumo de aire)",
          "Inmersión 4: Buceo desde barco o identificación de peces",
          "Inmersión 5: Buceo en naufragios o nocturno y de visibilidad limitada",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Esto me certifica como Deep Diver?",
        answer:
          "No, te certifica como Advanced Adventurer con un límite de profundidad de {depth30}. Para obtener la especialidad completa de Deep Diving (hasta {depth40}), puedes completar las inmersiones restantes del programa de especialidad Deep.",
      },
    ],
  },
  "ssi-diver-stress-and-rescue": {
    description: "Aprende a prevenir, reconocer y manejar el estrés y las emergencias de buceo.",
    summary: "Gana confianza aprendiendo a prevenir problemas y a manejar emergencias de buceo",
    overview:
      "El estrés es uno de los grandes factores en los accidentes de buceo. El programa SSI Diver Stress & Rescue te da las habilidades y los conocimientos para reconocer el estrés, prevenir accidentes y responder con eficacia en situaciones de emergencia.\n\nAprenderás a identificar el estrés en ti y en otros buceadores, a manejar el pánico, a hacer rescates de buceadores desde la profundidad y en la superficie, a dar respiraciones de rescate en el agua y a coordinar los procedimientos de respuesta a emergencias.\n\nA la mayoría de los buceadores este curso les parece exigente, gratificante y el programa que más confianza da en el buceo recreativo.",
    durationText: "3 días · Sesiones en alberca + escenarios en aguas abiertas",
    groupSizeText:
      "Equipos de escenarios con supervisión directa de seguridad por parte del instructor",
    prerequisiteNote:
      "Certificación Open Water Diver y capacitación vigente de primeros auxilios, RCP y proveedor de oxígeno (como SSI React Right). Edad mínima de 12 años.",
    includes: [
      "Kit de aprendizaje digital SSI y tarifa de certificación",
      "Sesiones de habilidades de rescate en alberca y aguas confinadas",
      "Escenarios de rescate en aguas abiertas",
      "Tanques y lastre",
    ],
    excludes: [
      "Mascarilla de bolsillo",
      "Certificación de primeros auxilios y RCP (se puede tomar al mismo tiempo)",
    ],
    scheduleDays: [
      {
        title: "Día 1: Autorrescate y manejo del estrés",
        items: [
          "Psicología del estrés, detonantes del pánico e intervención temprana",
          "Sesión en alberca: autorrescate, alivio de calambres, remolque de buceador cansado y defensa ante un buceador en pánico",
        ],
      },
      {
        title: "Día 2: Técnicas de rescate y búsqueda de buceador perdido",
        items: [
          "Llevar a la superficie a un buceador inconsciente desde la profundidad, ascensos controlados con flotabilidad",
          "Respiración artificial en superficie, retiro del equipo y técnicas de salida del agua",
          "Patrones de búsqueda submarina de buceadores perdidos",
        ],
      },
      {
        title: "Día 3: Escenarios de rescate en aguas abiertas",
        items: [
          "Escenario 1: Buceador inconsciente en la profundidad y rescate en superficie con respiraciones de rescate en el agua",
          "Escenario 2: Manejo de un buceador angustiado y en pánico en la superficie y salida al barco",
          "Debriefing del plan de acción de emergencia y graduación",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Necesito antes la capacitación de RCP y primeros auxilios?",
        answer:
          "Sí. Debes tener certificaciones vigentes de RCP y primeros auxilios (de los últimos 24 meses). SSI React Right se puede completar junto con este curso.",
      },
    ],
  },
  "ssi-scuba-skills-update": {
    description:
      "Un repaso rápido e integral para que tus habilidades de buceo vuelvan a estar afinadas y cómodas.",
    summary:
      "Repasa tus conocimientos, el manejo del equipo y tus habilidades en el agua antes de tu próxima inmersión",
    overview:
      "Si han pasado varios meses o años desde tu última inmersión, el SSI Scuba Skills Update es la mejor forma de recuperar tu confianza y tu comodidad en el agua.\n\nCon un profesional SSI repasarás la planificación de inmersiones, las reglas de buceo seguro y el armado del equipo. En una alberca o en un entorno de aguas confinadas tranquilas practicarás habilidades fundamentales como el despeje de la máscara, el control de flotabilidad y los procedimientos de emergencia.\n\nSe puede agregar una inmersión opcional en aguas abiertas para poner en práctica en el arrecife tus habilidades ya repasadas.",
    durationText: "Medio día (aprox. 3–4 horas)",
    groupSizeText: "Un ambiente relajado y de apoyo, en grupo pequeño",
    prerequisiteNote:
      "Certificación Open Water Diver o superior de cualquier agencia reconocida. Se requiere cuestionario médico.",
    includes: [
      "Constancia digital o registro digital de que completaste el Skills Update de SSI",
      "Repaso en salón y briefing",
      "Sesión en alberca o aguas confinadas",
      "Alquiler del equipo de buceo completo",
    ],
    excludes: ["Inmersión opcional en aguas abiertas desde barco"],
    scheduleDays: [
      {
        title: "Sesión de repaso",
        items: [
          "Armado del equipo, revisiones de seguridad y repaso de tablas de inmersión o de la computadora",
          "Sesión en alberca: habilidades con la máscara, recuperación del regulador, posición en el agua y flotar en el sitio",
          "Repaso de procedimientos de emergencia y actualización de la bitácora en MySSI",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Recibiré una nueva credencial de certificación?",
        answer:
          "Recibirás una credencial digital oficial de reconocimiento del Scuba Skills Update en tu app MySSI que confirma tu repaso.",
      },
    ],
  },
};
