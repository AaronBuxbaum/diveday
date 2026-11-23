// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplateCopyEs } from "./types";

export const COPY_ES_C1: Record<string, CourseTemplateCopyEs> = {
  "ssi-dive-guide": {
    description:
      "El primer paso del liderazgo profesional en SSI: aprende a guiar a buceadores certificados.",
    summary: "Da el salto al buceo profesional: guía a buceadores certificados y da los briefings",
    overview:
      "El programa SSI Dive Guide es la base de la ruta SSI Dive Professional. Aprenderás a guiar a buceadores certificados en distintos entornos y condiciones bajo el agua.\n\nCon práctica real, briefings de inmersión, evaluación de sitios y entrenamiento de liderazgo en el agua, desarrollarás las habilidades de organización y supervisión que se esperan de un guía de buceo profesional.\n\nJunto con la especialidad Science of Diving, la certificación Dive Guide te califica como SSI Divemaster.",
    durationText: "1–2 semanas (o formato de internado)",
    groupSizeText: "Mentoría profesional y práctica de guiado",
    prerequisiteNote:
      "SSI Diver Stress & Rescue (o equivalente), certificación vigente de RCP, primeros auxilios y O2, al menos 40 inmersiones registradas para empezar (50 para certificarte) y tener al menos 15 años (18 para el estatus profesional activo).",
    includes: [
      "Materiales profesionales digitales de SSI Dive Guide",
      "Talleres de liderazgo y manejo de grupos",
      "Evaluaciones prácticas de guiado y briefings",
      "Tanques y plomos durante las sesiones del curso",
    ],
    excludes: [
      "Cuotas de registro y membresía profesional de SSI",
      "Seguro de responsabilidad civil profesional",
      "Equipo de buceo profesional personal completo",
    ],
    scheduleDays: [
      {
        title: "Semana 1: liderazgo y briefings",
        items: [
          "El papel del Dive Guide, manejo de riesgos y responsabilidades legales",
          "Evaluación del sitio de buceo y del clima, y preparación del briefing de inmersión",
          "Técnicas de guiado en el agua, control del grupo y prevención de problemas",
        ],
      },
      {
        title: "Semana 2: guiado práctico y evaluaciones de resistencia",
        items: [
          "Evaluaciones de condición en el agua: nadar, flotar y remolcar a un buceador cansado",
          "Briefings de inmersión reales e inmersiones guiadas dirigidas por los alumnos",
          "Manejo de escenarios de emergencia y debriefing",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Cuál es la diferencia entre Dive Guide y Divemaster en SSI?",
        answer:
          "Un SSI Dive Guide que además completa la especialidad SSI Science of Diving obtiene el prestigioso rango de SSI Divemaster.",
      },
    ],
  },
  "sdi-scuba-discovery": {
    description: "Tu primera respiración bajo el agua, con un instructor al alcance de la mano.",
    summary: "Descubre en una tarde si respirar bajo el agua es lo tuyo",
    overview:
      "SDI Scuba Discovery no es una certificación. Es la sesión donde descubres cómo se siente realmente el buceo, con un instructor a tu lado todo el tiempo y sin nada que aprobar.\n\nEmpezarás en aguas poco profundas y confinadas: cómo funciona el equipo, cómo despejar la máscara, cómo recuperar el regulador. Cuando te sientas cómodo — y solo entonces — puedes hacer una inmersión somera en aguas abiertas, en el arrecife.\n\nSi te encanta, las habilidades cuentan para tu curso Open Water Scuba Diver. Si no, perdiste una tarde y ganaste una respuesta.",
    durationText: "Medio día · unas 3 horas",
    groupSizeText: "Grupos pequeños, con un instructor en el agua todo el tiempo",
    prerequisiteNote:
      "No necesitas certificación ni experiencia. Primero completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear, así que avísanos pronto si podría aplicarte.",
    includes: [
      "Todo el equipo de buceo",
      "Sesión en aguas confinadas dirigida por un instructor",
      "Una inmersión somera en aguas abiertas, si estás listo",
    ],
    excludes: ["Fotos y video", "Transporte al sitio"],
    scheduleDays: [
      {
        title: "Sesión de descubrimiento",
        items: [
          "Briefing: cómo funciona el equipo y qué se siente en el agua",
          "Aguas confinadas: respirar, despejar la máscara, recuperar el regulador",
          "Inmersión opcional somera en el arrecife con tu instructor",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Qué tan profundo voy a bajar?",
        answer: "No más de {depth12}, y solo hasta donde te sientas cómodo.",
      },
      {
        question: "¿Recibo una tarjeta de certificación?",
        answer:
          "No — esto es una experiencia, no un curso. Lo que aprendes aquí puede acreditarse al curso Open Water Scuba Diver si decides continuar.",
      },
    ],
  },
  "sdi-open-water-scuba-diver": {
    description:
      "La certificación de nivel inicial de SDI — con computadora de buceo desde la primera inmersión.",
    summary:
      "Certifícate para bucear con un compañero, en cualquier parte del mundo, hasta {depth18}",
    overview:
      "SDI Open Water Scuba Diver es la certificación que te permite alquilar equipo, reservar un barco y bucear con un compañero en cualquier lugar del mundo.\n\nLo que lo distingue de los cursos de nivel inicial de otras agencias es la computadora. SDI enseña a planear la inmersión con una computadora de buceo personal desde el principio, en lugar de tablas impresas, porque eso es lo que usarás en todas tus inmersiones después. Igual aprendes cómo funciona la descompresión — solo que la aprendes en el aparato que llevarás en la muñeca.\n\nCubrirás la parte teórica, practicarás las habilidades en aguas confinadas hasta que te aburran y luego harás cuatro inmersiones en aguas abiertas en el arrecife con tu instructor.",
    durationText: "Tres a cuatro días · cuatro inmersiones en aguas abiertas",
    groupSizeText: "Grupos pequeños, para que nadie espere en la fila su turno",
    prerequisiteNote:
      "No se necesita certificación. Los buceadores de 10 a 14 años se certifican como Junior Open Water Scuba Diver y bucean con límites menos profundos: de 10 a 11 con un profesional del buceo o un padre o tutor certificado, de 12 a 14 con cualquier adulto certificado. Debes sentirte cómodo en el agua y completar un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear, así que avísanos pronto si podría aplicarte.",
    includes: [
      "eLearning de SDI y tarjeta de certificación digital",
      "Todo el equipo de buceo para el curso",
      "Sesiones de entrenamiento en aguas confinadas",
      "Cuatro inmersiones de entrenamiento en aguas abiertas",
    ],
    excludes: ["Máscara, aletas y snorkel personales", "Transporte al sitio"],
    scheduleDays: [
      {
        title: "Día uno — teoría y aguas confinadas",
        items: [
          "Repaso de conocimientos con tu instructor y configuración de tu computadora de buceo",
          "Armado del equipo, revisión con tu compañero y entradas al agua",
          "Aguas confinadas: máscara, regulador, flotabilidad y ejercicios de falta de aire",
        ],
      },
      {
        title: "Día dos — las dos primeras inmersiones en aguas abiertas",
        items: [
          "Inmersión uno en el arrecife: descenso, flotabilidad y habilidades en profundidad",
          "Inmersión dos en el arrecife: nociones de navegación y un ascenso controlado",
        ],
      },
      {
        title: "Día tres — las dos últimas inmersiones y certificación",
        items: [
          "Inmersiones tres y cuatro en el arrecife, planeadas con tu propia computadora",
          "Evaluación final de habilidades y emisión de tu tarjeta digital",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Hasta qué profundidad me certifica para bucear?",
        answer:
          "{depth18}, que es donde está la vida del arrecife de todos modos. Los buceadores de 10 a 14 años mantienen un límite menos profundo que viene con la certificación junior.",
      },
      {
        question: "¿Por qué una computadora en vez de tablas?",
        answer:
          "Porque la computadora es con lo que vas a bucear. SDI enseña a planear en el aparato que realmente usarás, así que no hay nada que desaprender después.",
      },
    ],
  },
  "sdi-advanced-adventure-diver": {
    description:
      "Cinco inmersiones que te abren la puerta a la profundidad, la navegación y lo que elijas después.",
    summary: "Cinco inmersiones guiadas — profunda y navegación, más tres que tú eliges",
    overview:
      "Advanced Adventure Diver es el siguiente peldaño de SDI, y deliberadamente no es un curso de salón. Buceas cinco veces con un instructor, y cada inmersión es la primera de una especialidad distinta.\n\nDos son fijas: una inmersión profunda y una de navegación submarina. Las otras tres las eliges tú — nocturna, de naufragio, de corriente, desde barco, fotografía, lo que esta costa ofrezca y te dé curiosidad.\n\nCada una cuenta para la especialidad completa si decides terminarla más adelante. La mayoría de los buceadores sale de este curso sabiendo cuáles dos quiere.",
    durationText: "Dos días · cinco inmersiones",
    groupSizeText: "Grupos pequeños, según las electivas que elijas",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o una certificación equivalente de otra agencia — verificamos tu registro de certificación antes de la primera inmersión. Tener al menos 10 años; los menores de 18 necesitan el consentimiento de un padre o tutor. En cada inmersión aplican los límites de profundidad para menores: {depth12} a los 10–11 años y {depth18} a los 12–14 ({depth21} con una certificación avanzada). Los menores de 15 bucean bajo la supervisión directa de un padre, tutor o profesional del buceo, y eligen electivas que SDI abre para su edad. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Cinco inmersiones dirigidas por un instructor",
      "Tanques y lastre",
    ],
    excludes: ["Alquiler de equipo personal", "Equipo especializado para algunas electivas"],
    scheduleDays: [
      {
        title: "Día uno — profundidad y navegación",
        items: [
          "Inmersión profunda: planeación del gas, conciencia de la narcosis y un perfil de ascenso real",
          "Inmersión de navegación: referencias naturales, rumbos con brújula y cómo volver a encontrar la línea",
        ],
      },
      {
        title: "Día dos — tus tres electivas",
        items: [
          "Tres inmersiones de las especialidades en las que esta costa es mejor",
          "Debriefing sobre cuáles vale la pena terminar",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Qué tan profunda es la inmersión profunda?",
        answer:
          "No más de {depth30} para adultos; {depth12} a los 10–11 años y {depth18} a los 12–14 ({depth21} con una certificación avanzada). Menos si ahí la inmersión es mejor. Es una introducción supervisada a la profundidad, no un récord.",
      },
      {
        question: "¿Es lo mismo que Advanced Open Water?",
        answer:
          "Es el peldaño equivalente de SDI y se reconoce como tal. Nuestro sistema registra niveles de certificación y no los nombres propios de cada agencia, así que se guarda como una certificación avanzada.",
      },
    ],
  },
  "sdi-rescue-diver": {
    description:
      "Detecta un problema a tiempo y sabe exactamente qué hacer cuando ya no puedas evitarlo.",
    summary: "El curso que cambia cómo miras a todos los demás en el barco",
    overview:
      "Todos los buceadores que lo han tomado dicen lo mismo: es el curso donde dejas de ser un pasajero.\n\nAprenderás a leer el estrés antes de que se vuelva pánico, a manejar a un buceador cansado en la superficie, a subir a un buceador inconsciente y darle respiraciones de rescate camino al barco, y a manejar los primeros diez minutos de una emergencia mientras alguien más da el aviso.\n\nEs exigente y no es un fin de semana relajado. También es la razón por la que una tripulación se alegra de tenerte a bordo.",
    durationText: "Dos a tres días · aguas confinadas y escenarios en aguas abiertas",
    groupSizeText: "Grupos pequeños — cada buceador hace todos los escenarios",
    prerequisiteNote:
      "SDI Open Water Scuba Diver o equivalente, además de RCP y primeros auxilios vigentes. Si no los tienes, podemos impartir RCP y primeros auxilios junto con el curso. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear. Impartimos Rescue Diver a partir de los 18 años. SDI permite buceadores desde los 10 con el consentimiento de un padre o tutor, pero este curso está pensado para rescates de talla adulta.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Sesiones de habilidades de rescate en aguas confinadas",
      "Escenarios de rescate en aguas abiertas",
      "Tanques, plomos y equipo de rescate",
    ],
    excludes: [
      "Certificación de RCP y primeros auxilios, si la necesitas",
      "Alquiler de equipo personal",
    ],
    scheduleDays: [
      {
        title: "Día uno — autorrescate y reconocimiento",
        items: [
          "Leer el estrés y la fatiga antes de que se conviertan en un incidente",
          "Habilidades de autorrescate y apoyo en la superficie a un buceador cansado",
          "Práctica en aguas confinadas: aproximaciones, remolques y retiro del equipo",
        ],
      },
      {
        title: "Día dos — escenarios en aguas abiertas",
        items: [
          "Patrones de búsqueda de un buceador desaparecido desde el barco",
          "Buceador inconsciente: ascenso, respiraciones de rescate y salida del agua",
          "Manejar los primeros diez minutos: oxígeno, entrega y qué le dices a tierra",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Necesito capacitación en primeros auxilios antes?",
        answer:
          "Necesitas certificación vigente de RCP y primeros auxilios antes de que se emita la tarjeta. Si no tienes una, avísanos al reservar y la impartimos junto con el curso.",
      },
    ],
  },
  "sdi-divemaster": {
    description:
      "El primer rango profesional — dirigir a otros buceadores, no solo bucear con ellos.",
    summary: "Convierte el buceo en tu trabajo: guía, supervisa y maneja el día de buceo del barco",
    overview:
      "SDI Divemaster es donde el buceo deja de ser un pasatiempo y empieza a ser un trabajo por el que te pagan. Es el curso más largo que impartimos y el que tiene más tiempo en el agua.\n\nPerfeccionarás tus propias habilidades hasta que sirvan de demostración, aprenderás a planear y supervisar inmersiones para personas que no están tan cómodas como tú, darás briefings que la gente sí recuerda y manejarás las partes de un día de buceo que nadie ve — el barco, el papeleo, el buceador que en silencio no está bien.\n\nGran parte ocurre junto con nuestros cursos y salidas reales, porque nada sustituye hacerlo con clientes de verdad.",
    durationText: "De cuatro a ocho semanas, según tu agenda",
    groupSizeText: "Mentoría uno a uno y en grupos pequeños con nuestros instructores",
    prerequisiteNote:
      "SDI Rescue Diver o una certificación de rescate equivalente, capacitación vigente en RCP y primeros auxilios, y un historial de inmersiones registradas — SDI pide 40 inmersiones registradas para empezar y 60 para certificarte. Para el entrenamiento profesional se requiere un examen médico de buceo firmado por un médico; habla con nosotros pronto, porque puede tardar en conseguirse.",
    includes: [
      "Materiales digitales y tarjeta de certificación de SDI Divemaster",
      "Inmersiones de entrenamiento con mentoría y circuitos de habilidades",
      "Experiencia supervisada en cursos y salidas reales",
      "Tanques y plomos durante todo el curso",
    ],
    excludes: [
      "Membresía profesional y seguro de SDI",
      "Equipo personal, del que a estas alturas querrás tener el tuyo",
      "Examen médico de buceo",
    ],
    scheduleDays: [
      {
        title: "Fase uno — tu propio buceo",
        items: [
          "Circuito de habilidades con calidad de demostración",
          "Evaluaciones de dominio del agua y repaso de rescate",
          "Planeación de inmersiones, manejo del gas y evaluación del sitio",
        ],
      },
      {
        title: "Fase dos — dirigir a otras personas",
        items: [
          "Briefings, guiado y manejo de un grupo con corriente",
          "Asistir en cursos reales de Open Water y de educación continua",
          "Manejo del barco, manifiestos y manejo de emergencias",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Cuántas inmersiones necesito?",
        answer:
          "SDI pide 40 inmersiones registradas para empezar y 60 al momento de certificarte. Si te faltan, te ayudamos a completarlas durante el curso.",
      },
    ],
  },
  "sdi-solo-diver": {
    description:
      "El curso propio de SDI: autosuficiencia, redundancia y una autoevaluación honesta.",
    summary: "Aprende a ser tu propio compañero — bien equipado y bien honesto contigo",
    overview:
      "SDI escribió el primer curso recreativo de buceo en solitario, y sigue siendo la referencia de la industria. Ninguna de las otras agencias que impartimos ofrece uno equivalente.\n\nEl curso trata mucho menos de bucear solo de lo que el nombre sugiere. Trata de la redundancia — un segundo suministro de gas al que realmente llegues, una segunda computadora, una segunda herramienta de corte — y de la aritmética honesta de planear el gas cuando nadie va a venir a compartir el suyo.\n\nLa mayoría de los buceadores que lo toman nunca bucea solo. Lo toman porque los convierte en un compañero bastante mejor.",
    durationText: "Uno a dos días · al menos tres inmersiones",
    groupSizeText: "Grupos muy pequeños — este curso es sobre todo uno a uno",
    prerequisiteNote:
      "SDI Advanced Adventure Diver o una certificación avanzada equivalente, y un historial considerable de inmersiones registradas — SDI pide 100 inmersiones registradas. Trae tu propio equipo bien ajustado: este curso es sobre el equipo que conoces y se requiere un suministro de gas redundante. Completarás un cuestionario médico; algunas respuestas requieren la autorización de un médico antes de bucear.",
    includes: [
      "Tarjeta de certificación digital de SDI",
      "Al menos tres inmersiones de entrenamiento",
      "Suministro de gas redundante para el curso, si no tienes uno",
    ],
    excludes: ["Alquiler de equipo personal", "Computadora redundante"],
    scheduleDays: [
      {
        title: "Solo Diver",
        items: [
          "Planeación del gas sin la reserva de un compañero en las cuentas",
          "Redundancia: configurar y practicar un segundo suministro de gas",
          "Inmersiones: autorrescate, fallas de válvula y de regulador, y disciplina honesta con la presión de retorno",
        ],
      },
    ],
    faqs: [
      {
        question: "¿Este curso es solo para quienes quieren bucear solos?",
        answer:
          "No, y la mayoría de quienes lo toman no lo hace. La autosuficiencia y la planeación del gas te hacen un mejor compañero en cada inmersión que hagas con uno.",
      },
    ],
  },
};
