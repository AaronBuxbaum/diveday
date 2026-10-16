import { EditorSection, type EditorSectionRef } from "@/components/editor/EditorSection";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { EditableCourse } from "./course-types";
import { DayByDayEditor } from "./DayByDayEditor";
import { FaqEditor } from "./FaqEditor";

/** The editor's day-by-day and frequently-asked-questions sections. */
export function CourseScheduleFaqSections({
  course,
  dayByDay,
  faq,
  t,
}: {
  course: EditableCourse;
  dayByDay: EditorSectionRef;
  faq: EditorSectionRef;
  t: StaffTranslator;
}) {
  return (
    <>
      <EditorSection {...dayByDay} as="fieldset">
        <DayByDayEditor
          initialDays={course.scheduleDays}
          storageKey={`course-draft:${course.id}`}
          copy={{
            dayLabel: t.raw("courses.dayByDay.dayLabel"),
            removeDay: t("courses.dayByDay.removeDay"),
            dayTitleLabel: t.raw("courses.dayByDay.dayTitleLabel"),
            dayTitlePlaceholder: t("courses.dayByDay.dayTitlePlaceholder"),
            startTimeLabel: t.raw("courses.dayByDay.startTimeLabel"),
            endTimeLabel: t.raw("courses.dayByDay.endTimeLabel"),
            timeNoteLabel: t.raw("courses.dayByDay.timeNoteLabel"),
            timeNoteDescription: t("courses.dayByDay.timeNoteDescription"),
            timeNoteTitle: t("courses.dayByDay.timeNoteTitle"),
            timeNotePlaceholder: t("courses.dayByDay.timeNotePlaceholder"),
            whatHappens: t.raw("courses.dayByDay.whatHappens"),
            whatHappensHint: t("courses.edit.oneItemPerLine"),
            itemsPlaceholder: t("courses.dayByDay.itemsPlaceholder"),
            itemsOverMaxOne: t.raw("courses.dayByDay.itemsOverMaxOne"),
            itemsOverMaxOther: t.raw("courses.dayByDay.itemsOverMaxOther"),
            daysMaxOne: t.raw("courses.dayByDay.daysMaxOne"),
            daysMaxOther: t.raw("courses.dayByDay.daysMaxOther"),
            addDay: t("courses.dayByDay.addDay"),
          }}
        />
      </EditorSection>

      <EditorSection {...faq} as="fieldset">
        <FaqEditor
          initialFaqs={course.faqs}
          storageKey={`course-draft:${course.id}`}
          copy={{
            questionLabel: t.raw("courses.faq.questionLabel"),
            questionPlaceholder: t("courses.faq.questionPlaceholder"),
            answerLabel: t("courses.faq.answerLabel"),
            answerPlaceholder: t("courses.faq.answerPlaceholder"),
            removeFaq: t.raw("courses.faq.removeFaq"),
            addFaq: t("courses.faq.addFaq"),
            faqsMaxOne: t.raw("courses.faq.faqsMaxOne"),
            faqsMaxOther: t.raw("courses.faq.faqsMaxOther"),
            empty: t("courses.faq.empty"),
          }}
        />
      </EditorSection>
    </>
  );
}
