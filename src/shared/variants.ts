// The alternatives from the info popups that the site can switch to, so a different requirement
// can be tried on the real thing. Each is a flag that the pages and the services check. It's saved
// in this browser for every account here, since it changes what the site is, not a person's
// settings. `groups` are flags that can't be on together: switching one on turns the others off.

interface Variant {
  // Exactly as it's worded in lib/reqTopics.ts, which is how a popup finds its button.
  alternative: string;
  // Other wordings of the same change, on other popups.
  sameAs?: string[];
  groups?: string[];
}

export const VARIANTS = {
  // S1: My courses and navigation.
  'academics-tab': { alternative: 'Put the course record and degree plan under their own Academics tab.' },
  'plain-course-list': { alternative: 'Show a plain list rather than cards.' },
  'group-courses-by-term': { alternative: 'Group classes by term, with past terms kept for reference.' },
  'minimal-course-card': { alternative: 'Show just the code and title, and keep details on the class page.' },
  'hide-small-counts': { alternative: 'Hide the count as well, until a class has enough people to be useful.' },
  // S1: Find courses.
  'search-version-a': { alternative: 'Version A: code or title, with no wildcards, plus term and subject filters.', groups: ['term-filter'] },
  'search-professors': { alternative: "Also search by professor's name." },
  'search-all-terms': { alternative: 'Search all terms at once, with the term shown beside each result.', groups: ['term-filter'] },
  'filter-by-subject': { alternative: 'Version A: filter by subject instead of level.' },
  'filter-faculty-credits': { alternative: 'Filter by faculty or number of credits.' },
  'no-timetable-filter': { alternative: 'Version A: search knows nothing about when a section meets.', groups: ['search-times'] },
  'filter-day-time': { alternative: 'Filter by day of the week or time of day.', groups: ['search-times', 'section-times'] },
  'no-schedule-paste': { alternative: 'Join one class at a time only.' },
  // S1: sections and clashes.
  'several-sections': { alternative: 'Allow being in several sections of one course, such as a lecture and a lab.' },
  'no-section-times': { alternative: 'Version A: nothing about when a section meets.', groups: ['section-times'] },
  'block-clashes': { alternative: 'Block joining a section that clashes.', groups: ['clashes'] },
  'no-clash-notes': { alternative: 'Say nothing, and leave timetables to Minerva.', groups: ['clashes'] },
  // S1: classmates, privacy and leaving.
  'classmates-version-a': { alternative: 'Version A: name and email only, shown once someone posts, replies or joins a study session.', groups: ['who-is-listed', 'profile-fields'] },
  'anonymous-posts': { alternative: 'Let students post anonymously to classmates, as Ed does.' },
  'list-members': { alternative: 'List members, with a way for each student to opt out.', groups: ['who-is-listed'] },
  'full-class-list': { alternative: 'Show a full class list to professors.' },
  'choose-visible-fields': { alternative: 'Let students choose which fields classmates can see.', groups: ['profile-fields'] },
  'delete-on-leave': { alternative: 'Delete everything you added to the section when you leave.' },
  'leave-at-term-end': { alternative: 'Leave classes automatically when the term ends.' },
  'no-browse-links': { alternative: 'Leave these out, since the top navigation already goes there.' },
  // S2: group chat links.
  'chats-on-overview': { alternative: "Show the links on the class's Overview rather than on a tab of their own." },
  'plain-link-list': { alternative: 'A plain list of links instead of large cards.' },
  'private-links': { alternative: 'Version A: private to whoever adds it until they share it.', groups: ['new-links'] },
  'approve-links': { alternative: 'Have a classmate or professor approve links before they appear.', groups: ['new-links'] },
  'link-same-url-only': { alternative: 'Version A: duplicates are the same URL in the same class, after light normalization.' },
  'whatsapp-discord-only': { alternative: 'Allow only WhatsApp and Discord links.' },
  'no-link-purpose': { alternative: 'Version A: platform, name, who added it and when, with no purpose.' },
  'no-link-name': { alternative: "Use the platform's name alone, with no name to fill in." },
  'pick-link-platform': { alternative: 'Have the person adding the link pick the platform from a list.' },
  'links-likely-broken': {
    alternative: "Version A: at 3 reports it's marked likely broken, and changing the URL clears them.",
    sameAs: ["Version A: reports show on the link; at 3 it's marked likely broken, never hidden."],
    groups: ['link-hiding'],
  },
  'never-hide-links': { alternative: 'Hide nothing: keep every link listed, with its reports showing.', groups: ['link-hiding'] },
  'moderate-reported-links': { alternative: 'Send reported links to a professor or moderator to decide.', groups: ['link-hiding'] },
  'hide-link-owner': { alternative: 'Hide who added it, so people share more freely.' },
  'warn-leaving-site': { alternative: 'Warn before leaving UniLink for another site.' },
  'no-copy-link': { alternative: 'Only allow opening links, so they stay within the class.' },
  'anyone-fixes-links': { alternative: 'Let anyone in the section fix a link.' },
  'no-works-votes': { alternative: 'Version A: reports only, with no way to say a link works.' },
  // S4: discussion board.
  'shared-course-board': { alternative: 'Version A: one board per course per term, shared by all its sections.', sameAs: ['Version A: one class per course per term; sections share it.'] },
  'discussion-elsewhere': { alternative: 'Keep discussions on Ed or myCourses and only link to them.' },
  'typed-search-filters': { alternative: 'Replace the filters with one search box and typed filters such as "topic:exams".' },
  'search-replies': { alternative: 'Search replies here as well.', groups: ['search-scope'] },
  'search-titles-only': { alternative: 'Search only post titles, to keep results short.', groups: ['search-scope'] },
  'feed-class-tabs': { alternative: 'Show one class at a time, with a tab for each.' },
  'free-form-post-type': { alternative: 'Version A: a free-form type with suggestions (Assignment, Midterm, Just yapping…).', groups: ['post-topics'] },
  'several-post-topics': { alternative: 'Let students add their own topics, or tag a post with several.', groups: ['post-topics'] },
  'any-reply-answers': { alternative: 'Count any reply as answering a question.' },
  'author-only-reply-alerts': {
    alternative: "Version A: only the post's author hears about new replies, so there's nothing to follow.",
    sameAs: ["Version A: only the post's author hears about new replies."],
    groups: ['reply-alerts'],
  },
  'notify-class-of-replies': { alternative: 'Notify the whole class of every reply.', groups: ['reply-alerts'] },
  'filter-feed-dates': { alternative: "Filter by the course's weeks or by a chosen date range." },
  'post-without-joining': { alternative: 'Let students read and post in a class without joining it.' },
  'post-version-history': { alternative: "Keep each post's earlier versions, and show them." },
  'no-edit-after-reply': { alternative: "Don't allow edits once someone has replied." },
  'delete-post-with-replies': { alternative: 'Version A: deleting a post deletes its replies too.', groups: ['deleting-posts'] },
  'no-delete-after-reply': { alternative: "Don't allow deleting a post once it has replies.", groups: ['deleting-posts'] },
  'replies-in-feed': { alternative: 'Show replies right in the feed instead of opening a thread.' },
  'read-per-post': { alternative: 'Mark each post as read one at a time, as Ed does.' },
  'poll-posts': { alternative: 'Add polls as a third kind of post.' },
  'plain-upvotes': { alternative: 'Use plain upvotes, as on Ed.', groups: ['reactions'] },
  'no-reactions': { alternative: 'Have no reactions at all.', groups: ['reactions'] },
  'threaded-replies': { alternative: 'Version A: threaded replies, one level of replies to replies.' },
  'inline-code-only': { alternative: 'Version A: inline code only.', groups: ['formatting'] },
  'post-toolbar': { alternative: 'Use a rich-text editor with buttons instead of typed marks.', groups: ['formatting'] },
  'text-only-posts': { alternative: 'Version A: text only.', groups: ['attachments'] },
  'any-file-attachments': { alternative: 'Allow any file, such as PDFs and code files.', groups: ['attachments'] },
  'no-post-drafts': { alternative: 'Have no drafts: closing the form discards what was written.', groups: ['drafts'] },
  'named-post-drafts': { alternative: 'Keep several named drafts per class.', groups: ['drafts'] },
  'students-cross-post': { alternative: 'Allow one post in several classes for students too.' },
  'no-post-titles': { alternative: 'Leave out the title, as in a group chat.' },
  'no-similar-posts': { alternative: 'Version A: nothing, so repeated questions just get posted.' },
  'merge-threads': { alternative: 'Let a professor merge duplicate threads.' },
  'any-classmate-audience': { alternative: 'Version A: anyone in the class can be picked as an audience, by email.' },
  'change-audience-later': { alternative: 'Let authors change who can see a post later on.' },
  'most-goats-on-top': { alternative: 'Let the most 🐐 reply rise to the top instead.' },
  'no-edit-accepted-reply': { alternative: "Don't allow editing once a reply has been accepted." },
  // S3: study sessions.
  'sessions-only-on-class': { alternative: 'List sessions only on each class page, with no page across classes.' },
  'campus-wide-sessions': { alternative: 'Show nearby or campus-wide sessions, not only your own classes.', groups: ['who-can-join-sessions'] },
  'open-to-all-mcgill': { alternative: 'Let anyone at McGill see and join a session, not just the class.', groups: ['who-can-join-sessions'] },
  'all-sessions-visible': {
    alternative: 'Version A: everyone in the class sees every session, because none are invite-only.',
    sameAs: ['Version A: everyone in the class can see every session.'],
  },
  'hide-past-sessions': { alternative: "Remove sessions from view once they're over." },
  'quick-session-form': { alternative: 'Ask only for a class and a time, and fill in the rest later.' },
  'all-sessions-on-my-page': { alternative: 'Show all sessions in your classes here, not only yours.' },
  'search-session-host': { alternative: "Search by host's name as well." },
  'session-filters-time-building': { alternative: 'Add time of day and building as filters.' },
  'session-calendar-view': { alternative: 'Show sessions on a map or calendar instead of a list.', groups: ['session-layout'] },
  'session-cards': { alternative: "Show sessions as cards, with who's hosting up front.", groups: ['session-layout'] },
  'fixed-session-types': { alternative: "Use a fixed list, like the discussion board's topics." },
  'one-off-sessions': { alternative: 'Version A: sessions are created one at a time.', groups: ['weekly-sessions'] },
  'separate-weekly-sessions': { alternative: 'Treat each week as a separate session with its own code.', groups: ['weekly-sessions'] },
  'hide-clashing-sessions': { alternative: 'Hide sessions that clash.', groups: ['session-clashes'] },
  'no-session-clash-notes': { alternative: 'Say nothing: only the calendar shows clashes.', groups: ['session-clashes'] },
  'session-place-one-field': { alternative: 'Version A: a place or a call link, in one text field.', groups: ['session-place'] },
  'pick-session-building': { alternative: 'Pick from a list of McGill buildings and bookable rooms.', groups: ['session-place'] },
  'meeting-link-for-all': { alternative: 'Show the link to everyone who can see the session.' },
  'session-start-and-length': { alternative: 'Ask only for a start time and a default length.' },
  'optional-session-limit': { alternative: 'Version A: the size limit is optional, and full sessions refuse new people.', groups: ['waitlist'] },
  'confirm-waitlist-spot': { alternative: "Ask the waitlist's next person to confirm before giving them the spot.", groups: ['waitlist'] },
  'host-approves-joins': { alternative: 'Have the host approve each person who asks to join.' },
  'session-chat': { alternative: 'Add a chat for the session, so people can coordinate inside UniLink.' },
  'everyone-sees-going': { alternative: 'Version A: everyone sees the names and emails of people going.' },
  'session-invite-by-email': { alternative: 'Version A: invite by McGill email; the person must be in the class.' },
  'session-invite-notification': { alternative: "Send invitations through UniLink's own notifications." },
  'session-codes-expire': { alternative: 'Make codes expire on their own after a set time.' },
  'invite-outside-class': { alternative: 'Let people outside the class join with an invite.' },
  'hosts-cannot-leave': { alternative: "Version A: hosts can't leave, only cancel, and edits don't notify anyone.", groups: ['host-leaving'] },
  'choose-next-host': { alternative: 'Let the host choose who takes over.', groups: ['host-leaving'] },
  'suggest-session-change': { alternative: 'Let anyone going suggest a change for the host to accept.' },
  'delete-cancelled-sessions': { alternative: 'Delete cancelled sessions right away rather than showing them as cancelled.' },
  'session-several-sections': { alternative: 'Let a session bring several sections of a course together.' },
  'auto-session-title': { alternative: 'Generate the title from the class and type.' },
  'session-goal-checklist': { alternative: 'Use a checklist of goals for the session.' },
  'no-time-polls': { alternative: 'Have no polls: the host picks a time, and people join or don\'t.', groups: ['time-polls'] },
  'availability-grid': { alternative: 'Use a calendar grid where people mark when they\'re free, like When2meet.', groups: ['time-polls'] },
  'show-who-voted': { alternative: 'Show who picked which time, not only the counts.' },
  'signup-poll-voters': { alternative: 'Sign up everyone who said that time works.' },
  'polls-close-themselves': { alternative: 'Close polls on their own after a few days.' },
  // A3: dates and deadlines.
  'no-calendar-page': { alternative: "Keep no calendar in the app and only send events to the student's own calendar." },
  'due-dates-not-countdowns': { alternative: 'Show due dates instead of countdowns.' },
  'choose-deadline-window': { alternative: 'Let each student choose how far ahead to look.' },
  'shared-deadline-check': { alternative: 'Check it off for the whole section, as one shared list.' },
  'professor-sees-checkoffs': { alternative: 'Let a professor see how many have checked it off.' },
  'personal-class-times': { alternative: 'Version A: personal; each student enters their own, and only they see it.', groups: ['shared-info'] },
  'approve-shared-changes': { alternative: 'Keep it shared, but have a classmate approve changes before everyone sees them.', groups: ['shared-info', 'deadline-sharing'] },
  'classes-through-breaks': { alternative: 'Keep classes going through breaks, and leave students to hide them.' },
  'cancel-one-lecture': { alternative: 'Allow a one-off change, such as a cancelled lecture.' },
  'coming-up-only-on-calendar': { alternative: 'Show this only on the calendar, filtered to the class.' },
  'no-syllabus-import': { alternative: 'Version A: not built; dates are only added by hand.', groups: ['syllabus'] },
  'professor-enters-dates': { alternative: "Have the section's professor enter the dates instead of reading a file.", groups: ['syllabus'] },
  'hide-key-dates': {
    alternative: "Version A: term key dates and final exams aren't included.",
    sameAs: ["Version A: McGill's key dates and final exams aren't included."],
    groups: ['finals'],
  },
  'manual-final-exams': { alternative: 'Have students enter final exams by hand, like any exam date.', groups: ['finals'] },
  'submit-work': { alternative: 'Let students actually submit the work, which would mark it done.', sameAs: ['Let students submit their work here, as on myCourses.'] },
  'calendar-without-plans': { alternative: 'Show the calendar and the planner on separate pages with no overlap.', groups: ['planner-placement'] },
  'one-add-form': { alternative: 'Use one form for all of these, with a type field.' },
  'continuous-calendar': { alternative: 'Scroll through time continuously instead of stepping.' },
  'agenda-view': { alternative: 'Add an agenda view that lists events in order.', groups: ['calendar-views'] },
  'only-month-week': { alternative: 'Keep only Month and Week.', groups: ['calendar-views'] },
  'filter-by-event-kind': { alternative: 'Filter by kind of event instead of by class.' },
  'colour-by-class': { alternative: 'Colour events by class instead of by kind.' },
  'day-popup': { alternative: 'Open a popup over the calendar rather than a list below.' },
  'print-semester': { alternative: 'Show the term as a single printable page.' },
  'busy-week-notification': { alternative: 'Warn about a busy week ahead by notification.' },
  'link-official-dates': { alternative: "Link to McGill's official dates page instead of copying the dates." },
  'only-official-dates': { alternative: "Leave out any date that isn't official yet." },
  'only-upcoming-dates': { alternative: 'Show only upcoming dates and hide the ones that have passed.' },
  'exact-exam-conflicts': { alternative: 'Only flag exams that truly overlap.' },
  'exam-conflict-rules': { alternative: "Point to McGill's rules for exam conflicts and how to ask for a change." },
  'only-my-exams': { alternative: 'Show only the exams for your own classes.' },
  'choose-upcoming-length': { alternative: 'Let each student choose the length of this list.' },
  'personal-deadlines': { alternative: 'Version A: deadlines are personal; each student enters their own.', groups: ['deadline-sharing'] },
  'ask-to-share-deadline': { alternative: 'Ask each time whether to share it, whether or not it has a class.', groups: ['deadline-sharing'] },
  'anyone-fixes-deadlines': { alternative: 'Let anyone in the section fix a shared deadline, as with the course details.' },
  'no-check-on-calendar': { alternative: 'Make checking off possible only on Home or in the planner.' },
  'colour-only-event-kind': { alternative: 'Rely on colour alone, to save space.' },
  'add-found-dates-right-away': { alternative: 'Add everything found straight away, with undo.' },
  'labs-and-readings': { alternative: 'Add a type for labs and readings.' },
  'date-without-time': { alternative: 'Allow a date with no time.' },
  'no-deadline-notes': { alternative: 'Leave out notes, and link to the assignment instead.' },
  // ST2: assignment planner.
  'prof-plan-totals': { alternative: 'Show professors how much time students plan for their assignments, as totals only.' },
  'planner-in-calendar': { alternative: 'Fold the planner into the calendar instead of giving it a tab.', groups: ['planner-placement'] },
  'no-take-today-off': { alternative: 'Let missed tasks roll over only at the end of the day, with no button.', groups: ['take-off'] },
  'choose-tasks-to-move': { alternative: 'Ask which tasks to move instead of moving them all.', groups: ['take-off'] },
  'plan-date-by-hand': {
    alternative: "Version A: enter the plan's due date by hand, and change it by hand if it moves.",
    sameAs: ["Version A: only the plan's own due date, changed by hand."],
    groups: ['following-deadlines', 'plan-source'],
  },
  'ask-before-moving-plan': { alternative: 'Ask before moving the plan, rather than moving it automatically.', groups: ['following-deadlines'] },
  'auto-plan-deadlines': { alternative: 'Create a plan automatically for every deadline.', groups: ['making-plans'] },
  'auto-plan-on-post': { alternative: 'Create a plan for each student automatically when an assignment is posted.', groups: ['making-plans'] },
  'offer-plan-new-deadline': { alternative: 'Offer a plan for each new deadline as soon as it appears.' },
  'calendar-first-then-plan': { alternative: 'Add the assignment to the calendar first, and offer to plan it afterwards.' },
  'spread-work-evenly': {
    alternative: 'Version A: spread work evenly over the days before the deadline, with 1 buffer day.',
    sameAs: ['Version A: same fields, with work spread evenly again.'],
    groups: ['scheduling', 'buffer'],
  },
  'place-tasks-yourself': { alternative: "Don't schedule anything: let students place each task themselves.", groups: ['scheduling'] },
  'one-task-a-day': { alternative: "Leave out time estimates, and schedule one task a day as in the board's example.", groups: ['scheduling'] },
  'only-posted-assignments': { alternative: 'Add only assignments the professor has posted.', groups: ['plan-source'] },
  'hide-finished-plans': { alternative: 'Delete finished plans automatically.' },
  'one-daily-budget': { alternative: 'Version A: one daily study budget (120 minutes by default) minus other tasks and sessions.', groups: ['free-time'] },
  'weekly-time-grid': { alternative: 'Choose time blocks in a weekly grid, not just minutes.', groups: ['free-time'] },
  'other-commitments': { alternative: 'Ask about work and other commitments as well.' },
  'holidays-as-days-off': { alternative: 'Treat holidays and reading breaks as days off automatically.' },
  'require-class-for-plan': { alternative: 'Require a class for every plan.' },
  'one-buffer-day': { alternative: "Version A: 1 buffer day by default, like the board's example.", groups: ['buffer'] },
  'proportional-buffer': { alternative: 'Size the buffer to the assignment, such as 10% of the time available.', groups: ['buffer'] },
  'keep-file-only': { alternative: 'Version A: the file is kept with the plan to open later, and nothing reads it.' },
  'daily-replan': { alternative: 'Replan automatically every day, with no button.' },
  'archive-plans': { alternative: 'Archive plans instead of deleting them.' },
  'progress-by-minutes': { alternative: 'Measure progress by minutes of work, not number of tasks.' },
  'refuse-plans-that-dont-fit': { alternative: "Refuse to save a plan that doesn't fit." },
  'missed-tasks-stay-late': { alternative: 'Leave missed tasks where they are, marked late, until the student moves them.' },
  'ask-new-task-minutes': { alternative: 'Ask how long each new task should take.' },
  'separate-todos-and-tasks': { alternative: 'Keep to-dos and planned tasks in two separate lists.' },
  'replan-moves-all': { alternative: 'Let re-plans move every task, even ones placed by hand.' },
  'drag-tasks': { alternative: 'Drag tasks between days on the calendar.' },
  'skip-tasks': { alternative: "Mark the task as skipped, keeping it in the plan's history." },
  'pick-assignment-from-list': { alternative: 'Pick the assignment from a list instead of typing its name.', groups: ['plan-source'] },
  'one-task-per-day-split': { alternative: 'Always split one assignment into one task per day.' },
  'no-exam-steps': { alternative: 'Treat exams like any other assignment.' },
  'estimate-from-past': { alternative: 'Estimate minutes from past assignments in the class.' },
  'share-task-lists': { alternative: 'Let classmates share task lists for the same assignment.' },
  'preview-plan': { alternative: 'Preview the plan day by day before saving it.' },
  'task-notes': { alternative: 'Add notes to each task rather than the whole plan.' },
  // A4: grade calculator.
  'calculator-only-in-class': { alternative: 'Keep the calculator only inside each class, as the board\'s "per class" suggests.' },
  'no-term-overview': { alternative: 'Stick to one class at a time, as the board\'s "per class" suggests.' },
  'personal-grading-scheme': {
    alternative: 'Version A: the scheme is personal, entered by each student with their own scores.',
    sameAs: ['Version A: each student enters their own scheme, with their scores.'],
  },
  'no-second-scheme': { alternative: "Version A: courses graded on two schemes aren't supported." },
  'quiz-components': { alternative: 'Add each quiz as its own component in the scheme.' },
  'shared-best-rule': { alternative: "Make this part of the shared scheme rather than each student's entry." },
  'no-contribution-column': { alternative: 'Leave out this column, to keep the table simple.' },
  'points-out-of-100': { alternative: 'Show points earned out of 100 instead of an average.' },
  'scale-to-listed-total': { alternative: "Version A: grades are scaled up to the listed total when weights don't reach 100%.", groups: ['scheme-total'] },
  'wait-for-100-percent': { alternative: "Don't calculate until the weights add up to 100%.", groups: ['scheme-total'] },
  'target-percentage': { alternative: 'Type a percentage rather than pick a letter.' },
  'target-gpa-term': { alternative: 'Set one target GPA for the term, and work out each class from it.' },
  'grade-slider': { alternative: 'Use a slider rather than a table.', groups: ['scenarios'] },
  'per-component-scenarios': { alternative: 'Let students type a different mark for each remaining component.', groups: ['scenarios'] },
  'percent-only-view': { alternative: 'Let students switch to a percentage-only view.' },
  'all-classes-one-page': { alternative: 'Show all classes on one page, with no picker.' },
  'single-projected-grade': { alternative: 'Show a single projected grade instead of a range.' },
  'target-from-cgpa': { alternative: "Suggest a target from your CGPA goal." },
  'term-gpa-only': { alternative: 'Show only the term GPA, and leave CGPA to the course record.' },
  // A5: course info.
  'course-info-on-mycourses': { alternative: 'Keep course info on myCourses and only link to it.' },
  'office-hours-on-calendar': { alternative: 'Make office hours a recurring event on the calendar.' },
  'link-outline': { alternative: 'Link to the outline on myCourses instead of storing a copy.' },
  'share-my-notes': { alternative: 'Let students share notes with the section.', groups: ['notes'] },
  'no-my-notes': { alternative: 'Leave note-taking to other apps.', groups: ['notes'] },
  'scheme-no-review': { alternative: 'Add it all at once, with no review.' },
  'section-average': { alternative: "Let students compare marks with the section's anonymous average." },
  // A1: course record.
  'no-course-record': { alternative: 'Leave this out: Minerva already keeps the official record.' },
  'official-cgpa-only': { alternative: 'Show only the official CGPA, entered by the student.' },
  'gpa-table': { alternative: 'Use a simple table instead of a chart.' },
  'no-cgpa-goal': { alternative: 'Leave this out and stick to per-class targets.' },
  'record-sync-classes': { alternative: 'Keep the record in sync with joined classes automatically.' },
  'record-flat-list': { alternative: 'Show one long list you can sort by any column.' },
  'status-from-term': { alternative: 'Work out the status from the term, with no choice to make.' },
  'record-now-after-final': { alternative: 'Show nothing until the final grade is in.' },
  'planned-no-term': { alternative: 'Let planned courses have no term yet.' },
  'grade-as-percentage': { alternative: 'Accept a percentage and convert it to a letter.' },
  // A2: degree plan.
  'link-degree-audit': {
    alternative: "Link to McGill's degree audit instead of building a plan here.",
    sameAs: ["Send students to Minerva's degree evaluation instead of calculating here."],
  },
  'suggest-term-schedule': { alternative: 'Suggest a full term-by-term schedule of courses.' },
  // ST1: study mode.
  'study-mode-toggle': { alternative: 'Make study mode a switch in the top bar, with no page of its own.' },
  'calm-focus-view': { alternative: "Change the whole app to a calmer, full-screen focus view while it's on." },
  'no-stopping-early': { alternative: "Don't allow stopping it early, to make the commitment stick." },
  'pomodoro': { alternative: 'Use a fixed Pomodoro timer (25 minutes on, 5 off) whatever the task.', groups: ['focus-length'] },
  'any-focus-length': { alternative: 'Let students type any length.', groups: ['focus-length'] },
  'study-mode-separate-from-tasks': { alternative: 'Keep study mode separate from planned tasks.' },
  'no-focus-checkin': { alternative: 'Never ask, and leave it to the student to tick off the task.', groups: ['focus-checkin'] },
  'ask-how-much-left': { alternative: "Ask how much is left, and adjust the plan's time for it.", groups: ['focus-checkin'] },
  'manual-study-mode': { alternative: 'Make study mode manual only, with nothing automatic.' },
  'hide-focus-clock': { alternative: "Hide the clock, so it doesn't distract." },
  'focus-leaderboard': { alternative: 'Compare focus time with classmates on a leaderboard.', groups: ['focus-tracking'] },
  'no-focus-tracking': { alternative: "Don't track focus time at all.", groups: ['focus-tracking'] },
  'study-own-class-times': { alternative: 'Version A: follows only the class times you entered yourself.' },
  'urgent-notifications-through': { alternative: 'Let urgent ones through, such as a session cancelled today.' },
  'one-study-setting': { alternative: 'Use one setting for all classes.' },
  // G4: accounts and profile.
  'separate-profile-page': { alternative: 'Separate the profile from the settings, with the goat on a public profile page.' },
  'photo-avatar': { alternative: 'Show a photo instead of a goat.', sameAs: ['Let students upload a profile photo.'], groups: ['avatar'] },
  'same-avatar': { alternative: 'Give every student the same avatar.', groups: ['avatar'] },
  'goat-unlocks': { alternative: 'Unlock goat parts by using the app, as a small reward.', groups: ['avatar'] },
  'auto-sign-out': { alternative: 'Sign out automatically after a period of inactivity, for shared computers.' },
  'no-sign-in-pause': { alternative: 'Version A: a hashed password and nothing more.', groups: ['wrong-tries'] },
  'one-sign-in-form': { alternative: 'Use a single form that signs you in or signs you up, depending on the email.' },
  'display-name': { alternative: 'Allow a nickname or display name instead of a legal name.', groups: ['names'] },
  'names-from-mcgill': { alternative: "Have names come from McGill, so they can't be changed here.", groups: ['names'] },
  'version-a-profile': { alternative: 'Version A: name, email (read-only), program, year and daily study time.', groups: ['signup-fields'] },
  'minimal-signup': { alternative: 'Ask only for name and email at sign-up, and everything else later.', groups: ['signup-fields'] },
  'other-universities': { alternative: "Open sign-up to other universities' email addresses." },
  'simple-password-rule': { alternative: 'Version A: 8+ characters with a letter and a number.', groups: ['password-rule'] },
  'password-strength-meter': { alternative: "Score the password's strength with a meter instead of fixed rules.", groups: ['password-rule'] },
  'no-confirm-password': { alternative: 'Type it once, with a show-password button to check it.' },
  'delete-everything': { alternative: 'Version A: everything they created is deleted.', sameAs: ['Version A: everything you created is deleted.'], groups: ['deleting-account'] },
  'always-delete-posts': { alternative: 'Always delete posts and replies with the account.', groups: ['deleting-account'] },
  'delete-shared-too': { alternative: 'Remove them too, which would leave gaps for classmates.' },
  'no-data-download': { alternative: 'Leave this out, since the board only asks for deletion.' },
  'delete-after-30-days': { alternative: 'Wait 30 days before deleting, so a mistake can be undone.' },
  // G3: notifications.
  'notify-version-a': { alternative: 'Version A: notify about invitations and individual reports instead of waitlists and hand-offs.' },
  'email-all-no-list': { alternative: 'Send every notification by email as well, with no separate in-app list.', groups: ['notification-list'] },
  'daily-summary': { alternative: 'Group everything into one daily summary instead of separate notifications.', groups: ['notification-list'] },
  'mark-read-on-open': { alternative: 'Mark everything read as soon as the list is opened.' },
  'filter-notifications': { alternative: 'Filter by class or by type of notification.' },
  'mute-whole-class': { alternative: 'Mute everything from the class, not just replies.', groups: ['muting'] },
  'no-mute-follow-only': { alternative: 'Rely only on following and unfollowing each thread.', groups: ['muting'] },
  'one-notification-switch': { alternative: 'Offer a single on or off switch for all notifications.', groups: ['notification-settings'] },
  'notify-per-class': { alternative: 'Choose notifications per class rather than per kind.', groups: ['notification-settings'] },
  'hide-email-options': { alternative: 'Hide email options until real delivery works.' },
  // ST3: to-do list.
  'week-of-tasks': { alternative: 'Show a week of tasks rather than just today.', groups: ['todo-list'] },
  'all-todos-one-list': { alternative: 'Show every to-do in one list, sorted by date.', groups: ['todo-list'] },
  'todo-date-picker': { alternative: 'Use a date picker next to the box instead of reading dates from the text.' },
  'todo-class': { alternative: 'Attach each to-do to a class.' },
  'drag-reorder-tasks': { alternative: 'Let students drag tasks to reorder them.' },
  'todo-trash': { alternative: 'Keep deleted to-dos in a trash for a while.' },
  'ask-delete-repeating': { alternative: 'Ask whether to delete one week or all of them, for a repeating to-do.' },
  // G2: integrations.
  'add-missing-course': { alternative: "Let students add a course that's missing from the catalogue." },
  'no-export-tasks': { alternative: 'Keep planned tasks inside UniLink only.' },
  // WEB: the site itself.
  'require-connection': { alternative: 'Require a connection and say so, rather than working offline.' },
  'refuse-no-storage': { alternative: "Refuse to run at all in a browser that can't save." },
  'empty-start': { alternative: 'Start with an empty app, and ask people to invite their real classmates.', groups: ['demo-accounts'] },
  'guided-tour': { alternative: 'Offer a guided tour instead of ready-made accounts.', groups: ['demo-accounts'] },
  'reset-own-data': { alternative: "Reset only your own account's data, leaving other accounts in the browser alone." },
  'encrypt-backup': { alternative: 'Encrypt backups with a passphrase, since they hold marks and notes.' },
  // WIRE: how the pages are laid out.
  'plain-wordmark': { alternative: 'Use a plain wordmark, without a mascot.' },
  'home-calendar': { alternative: 'Open on a calendar of the day instead of a discussion feed.', groups: ['home-main'] },
  'no-cross-class-feed': { alternative: "Keep each class's discussion on its own page, with no cross-class feed.", groups: ['home-main'] },
  'home-custom': { alternative: 'Let each student choose and order what appears on Home.' },
  'scrolling-tabs': { alternative: 'Version A: the tabs stay in the header, which scrolls sideways.', groups: ['phone-nav'] },
  'bottom-tabs': { alternative: 'Use a bottom tab bar on phones, like most mobile apps.', groups: ['phone-nav'] },
  'sort-activity': { alternative: 'Sort by latest activity, so a new reply brings a thread back up.' },
  // EXTRA: search, language, first steps and appearance.
  'search-this-page': { alternative: "Search only within the page you're on." },
  'search-catalogue': { alternative: 'Also search the whole course catalogue from this box.' },
  'search-classmates': { alternative: 'Let students search for classmates by name, which would need changing the no-member-list rule.' },
  'english-only': { alternative: 'English only, as the board is written.', groups: ['language'] },
  'browser-language': { alternative: "Follow the browser's language, with no switch.", groups: ['language'] },
  'setup-wizard': { alternative: 'Walk new accounts through a step-by-step setup before they reach Home.', groups: ['first-steps'] },
  'no-checklist': { alternative: 'No checklist: rely on helpful empty pages.', groups: ['first-steps'] },
  'settings-in-account-menu': { alternative: 'Put language and appearance in the account menu.' },
  'light-only': { alternative: 'Offer light mode only.' },
  'help-links': { alternative: 'Add links for help and feedback.' },
  // PROF: professors.
  'students-only': { alternative: 'Students only, as on the board.', groups: ['professors'] },
  'no-professor-features': { alternative: 'No professor features: the board is a peer space, run by students alone.', groups: ['professors'] },
  'ta-moderate': { alternative: 'Let teaching assistants do this too, not just the professor.' },
  'shared-prof-thread': { alternative: "Keep one thread shared across all the professor's sections." },
  'community-moderation': { alternative: 'Let students moderate together, with posts hidden after enough reports.', groups: ['reporting'] },
  'no-reporting': { alternative: "Have no reporting, since the board doesn't ask for it.", groups: ['reporting'] },
  'vote-not-pin': { alternative: 'Let the students in a class vote posts to the top instead.' },
  'lock-on-accept': { alternative: 'Lock a thread automatically once it has an accepted answer.' },
  'join-code': { alternative: 'Give each section a short join code instead of a link.' },
  'prof-edit-links': { alternative: 'Let professors edit or remove any link in their section.' },
  'students-post-assignments': { alternative: 'Let students post assignments too, as they do class deadlines.' },
  'extensions': { alternative: 'Allow a different due date per student, for accommodations.' },
  'no-assignment-weight': { alternative: 'Keep the scheme and assignments separate, and set weights only on the scheme.' },
  'draft-visible': { alternative: 'Show it to students right away, marked as a draft.' },
  'shared-assignment': { alternative: 'Have one assignment shared by all sections, with one due date.' },
  'handout-link': { alternative: 'Link to the handout on myCourses instead of attaching a copy.' },
  'notify-assignment-removed': { alternative: 'Notify students when an assignment is removed.' },
  'progress-private': { alternative: 'Show nothing, leaving this private to each student.', groups: ['assignment-progress'] },
  'progress-names': { alternative: "Show the professor who has and hasn't checked it off.", groups: ['assignment-progress'] },
  'office-hours-details-only': { alternative: 'Keep office hours as course details only, not as sessions.' },
  'shared-scheme': { alternative: "Let one scheme apply to all of a professor's sections." },
  // Simulated where the real thing needs a service: mail goes to the outbox and shows on screen.
  'reset-by-email-code': { alternative: 'Version A: a 6-digit code by email, valid 15 minutes.', groups: ['password-reset'] },
  'reset-by-email-link': { alternative: 'Email a reset link, once a mail server exists.', groups: ['password-reset'] },
  'confirm-email': { alternative: 'Send a confirmation email before the account can be used.' },
  'verify-professors': { alternative: "Verify professors through McGill's login or a confirmation email before they can teach a section." },
  'second-factor': { alternative: 'Ask for a second factor, such as an authenticator app.' },
  'sign-in-question': { alternative: 'Show a CAPTCHA after a few wrong tries instead of pausing sign-in.', groups: ['wrong-tries'] },
  'one-class-per-course': { alternative: 'Version A: one class per course per term, shared by all its sections.' },
  'drop-lowest': { alternative: 'Allow any number of schemes, or rules like dropping the lowest mark.' },
  'course-cutoffs': { alternative: "Use the professor's own cutoffs where a course sets them." },
  'offline-queue': { alternative: 'Offer a read-only view while offline, and queue changes for later.' },
  'check-prereqs': { alternative: "Check the prerequisites and when it's offered before adding it." },

  // New differences, beyond what the popups first listed
  'edit-window': { alternative: 'Only allow edits for 15 minutes after posting.' },
  'sort-unanswered': { alternative: 'Put unanswered questions first.' },
  'session-notice': { alternative: "Require at least an hour's notice for a new session." },
  'poll-ten-times': { alternative: 'Allow up to ten times instead of five.' },
  'lock-completed': { alternative: "Lock a completed course once it's saved, so the record can't drift from the transcript." },
  'name-change-limit': { alternative: 'Allow a name change only once a term.' },
  'ics-alarm': { alternative: 'Add a reminder an hour before to the exported file.' },
  'warn-over-15': { alternative: 'Warn above 15 credits a term instead of 18.' },
  'short-email': { alternative: 'Let people type only the part before the @.' },
  'confirm-mark-all': { alternative: 'Ask before marking everything as read.' },
  'copy-with-name': { alternative: "Copy the chat's name along with its link." },
  'high-contrast': { alternative: 'Add a high-contrast mode.' },
  'card-professor': { alternative: "Show the professor's name on each card." },
  'leave-tells-host': { alternative: 'Tell the host when someone leaves.' },
  'week-starts-sunday': { alternative: 'Start the week on Sunday instead of Monday.' },
  'plan-percent': { alternative: 'Show a percentage instead of a count.' },
  'marks-lost': { alternative: 'Show the points lost beside the points earned.' },
  'only-highest-possible': { alternative: "Show only the highest grade still possible, so it's less discouraging." },
  'gpa-hidden': { alternative: "Hide GPAs until clicked, for when someone's looking over your shoulder." },
  'degree-only-left': { alternative: "List only what's left, and leave out what's done." },
  'notify-sound': { alternative: 'Play a short sound when a notification arrives.' },
  'type-to-reset': { alternative: 'Ask people to type RESET before wiping everything.' },
  'goat-random': { alternative: 'Add a button for a random goat.' },
  'larger-text': { alternative: 'Offer larger text.' },
  'remember-filters': { alternative: 'Remember the filters between visits.' },
  'record-newest-first': { alternative: 'Show the newest term first.' },
} as const satisfies Record<string, Variant>;

export type VariantId = keyof typeof VARIANTS;

// Alternatives that can't be a switch, and why.
export const NOT_SWITCHABLE: Record<string, string> = {
  'Fill the list from Minerva automatically instead of having students join by hand.': 'This needs access to Minerva, which the site doesn’t have.',
  'Connect to Minerva directly, so classes appear without pasting.': 'This needs access to Minerva, which the site doesn’t have.',
  'Keep the catalogue in step with a live McGill feed instead of importing the yearly PDF.': 'This needs a live McGill data source, which the site doesn’t have.',
  'Take this from an official McGill source, so nobody has to enter it.': 'This needs an official McGill data source, which the site doesn’t have.',
  'Sync live with Google Calendar in both directions instead of exporting a file.': 'This needs access to a Google account, which the site doesn’t have.',
  'Import the official schedule when it\'s published.': 'This needs McGill’s published schedule as data, which the site doesn’t have.',
  'Use an AI service to read any syllabus layout, sending the file out of the browser.': 'This needs an AI service connected to the site, which it doesn’t have.',
  'Use an AI service to split any assignment, sending the file out of the browser.': 'This needs an AI service connected to the site, which it doesn’t have.',
  'Read free time from the student\'s Google Calendar, as the board\'s "free time in my calendar" could mean.': 'This needs access to a Google account, which the site doesn’t have.',
  'Pull the file from myCourses instead of uploading it.': 'This needs access to myCourses, which the site doesn’t have.',
  'Read marks from myCourses directly, so nobody has to enter them.': 'This needs access to myCourses, which the site doesn’t have.',
  'Import the record from Minerva instead of adding it by hand or pasting a transcript.': 'This needs access to Minerva, which the site doesn’t have.',
  'Read the record from Minerva, so it doesn\'t have to be entered.': 'This needs access to Minerva, which the site doesn’t have.',
  'Block distracting websites with a companion browser extension, the planned route.': 'A website can’t block other sites: this needs a browser extension to be built and installed.',
  'Offer full blocking in a desktop or mobile app.': 'A website can’t block other apps: this needs a desktop or mobile app.',
  'Also offer to sign out everywhere, on all devices.': 'Accounts live in one browser, so there are no other devices to sign out of.',
  'Add push notifications that reach a phone with the tab closed.': 'This needs a push server, which the site doesn’t have.',
  'Send real emails through a mail service.': 'This needs a mail service, which the site doesn’t have.',
  'Add it to Google Calendar directly, by connecting an account.': 'This needs access to a Google account, which the site doesn’t have.',
  'Connect to Google Calendar\'s API so changes sync on their own.': 'This needs access to a Google account, which the site doesn’t have.',
  'Offer a subscription link that calendar apps refresh by themselves.': 'A calendar app would need a server to fetch the link from, which the site doesn’t have.',
  'Connect to myCourses directly so deadlines appear by themselves.': 'This needs access to myCourses, which the site doesn’t have.',
  'Keep the data on a shared server, so classmates and devices stay in sync.': 'This needs a server, which the site doesn’t have.',
  "Merge a backup into what's there instead of replacing it.": 'Two copies number their records separately, so merging them would mix up whose is whose.',
  "Show McGill's name and colours next to the logo, if the school agrees.": 'This needs McGill’s permission.',
  'Import assignments from myCourses instead of posting them twice.': 'This needs access to myCourses, which the site doesn’t have.',
  'Sign in through McGill\'s own login (single sign-on) instead of a UniLink password.': 'This needs McGill’s login service, which the site can’t reach.',
  'Have a person at McGill reset the password after checking the student\'s ID.': 'This needs people at McGill to do it, so the site can’t switch to it alone.',
  "Use McGill's own requirement data instead of working out rules from the catalogue's text.": "McGill doesn't publish its requirements as data the site could read.",
};

const IDS = Object.keys(VARIANTS) as VariantId[];
const BY_ALTERNATIVE = new Map(IDS.flatMap((id) => [VARIANTS[id].alternative as string, ...((VARIANTS[id] as Variant).sameAs ?? [])].map((text) => [text, id] as const)));

export const variantFor = (alternative: string) => BY_ALTERNATIVE.get(alternative);

const groupsOf = (id: VariantId): string[] => (VARIANTS[id] as Variant).groups ?? [];

const STORAGE_KEY = 'unilink-variants';

function load(): VariantId[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? IDS.filter((id) => saved.includes(id)) : [];
  } catch {
    return [];
  }
}

let on = load();
const listeners = new Set<() => void>();

function changed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(on));
  } catch {
    // Without storage, the switches last until the page reloads.
  }
  listeners.forEach((listener) => listener());
}

export const isOn = (id: VariantId) => on.includes(id);
export const variantsOn = () => on;

export function subscribeVariants(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setVariant(id: VariantId, value: boolean) {
  const others = on.filter((other) => other !== id && !(value && groupsOf(other).some((group) => groupsOf(id).includes(group))));
  on = value ? [...others, id] : others;
  changed();
}

export function clearVariants() {
  on = [];
  changed();
}
