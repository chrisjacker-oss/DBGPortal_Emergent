import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { Btn } from "@/components/kit";
import { CalendarCheck, CheckCircle, LockSimple } from "@phosphor-icons/react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (value) => String(value).padStart(2, "0");
const toDateKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;

function monthCells(cursor) {
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array(first.getUTCDay()).fill(null);
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export default function PublicInstallSchedule() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [timeOfDay, setTimeOfDay] = useState("morning");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [offerAccepted, setOfferAccepted] = useState(false);

  useEffect(() => {
    api.get(`/pub/install-schedule/${token}`)
      .then((response) => setInfo(response.data))
      .catch((requestError) => {
        setError(requestError.response?.data?.detail || "This scheduling link is invalid.");
      });
  }, [token]);

  const months = useMemo(() => {
    if (!info?.date_from) return [];
    const start = new Date(`${info.date_from}T00:00:00Z`);
    return [0, 1, 2].map((offset) => (
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1))
    ));
  }, [info]);

  const isAllowed = (dateKey) => {
    if (!info || dateKey < info.date_from || dateKey > info.date_to) return false;
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    return weekday >= 1 && weekday <= 5;
  };
  const selectedFriday = selectedDate && new Date(`${selectedDate}T00:00:00Z`).getUTCDay() === 5;

  const chooseDate = (dateKey) => {
    if (!isAllowed(dateKey)) return;
    setSelectedDate(dateKey);
    if (new Date(`${dateKey}T00:00:00Z`).getUTCDay() === 5) setTimeOfDay("morning");
  };

  const submit = async () => {
    if (!selectedDate) {
      toast.error("Choose a tentative installation date");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/pub/install-schedule/${token}`, {
        preferred_date: selectedDate,
        time_of_day: timeOfDay,
        notes,
      });
      setDone(true);
    } catch (submitError) {
      toast.error(submitError.response?.data?.detail || "Could not submit your request.");
    } finally {
      setBusy(false);
    }
  };

  const acceptOffer = async () => {
    setBusy(true);
    try {
      await api.post(`/pub/install-schedule/${token}/accept-offer`, { note: notes });
      setOfferAccepted(true);
    } catch (acceptError) {
      toast.error(acceptError.response?.data?.detail || "Could not accept the offered date.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#EEF4F4] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-5xl border border-border bg-card" data-testid="public-install-schedule-page">
        <div className="flex items-center justify-between bg-[#0A0A0A] px-6 py-5 text-white">
          <div>
            <div className="font-display text-xl">DBG Signs, Inc.</div>
            <div className="mt-1 text-xs uppercase tracking-wide text-[#A5F3FC]">Installation scheduling</div>
          </div>
          <LockSimple size={20} weight="bold" className="text-[#16A34A]" />
        </div>
        <div className="h-[3px] bg-[#16A34A]" />

        <div className="p-5 sm:p-8">
          {error && <div className="py-10 text-center text-sm text-destructive" data-testid="public-install-schedule-error">{error}</div>}
          {!error && !info && <div className="py-10 text-center text-sm text-muted-foreground">Loading calendar…</div>}

          {!error && info && (done || offerAccepted || info.status === "submitted" || info.status === "accepted") && (
            <div className="mx-auto max-w-lg py-12 text-center" data-testid="public-install-schedule-success">
              <CheckCircle size={48} weight="fill" className="mx-auto text-[#16A34A]" />
              <h1 className="mt-4 font-display text-3xl">
                {offerAccepted || info.status === "accepted" ? "Installation date accepted" : "Tentative date received"}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {offerAccepted || info.status === "accepted"
                  ? "Thank you. Your installation date is confirmed and our team will follow up with any final details."
                  : "We received your tentative installation request. Our team will check the schedule and contact you to confirm whether the selected slot is available."}
              </p>
            </div>
          )}

          {!error && info && !done && !offerAccepted && info.status === "alternative_offered" && (
            <div className="mx-auto max-w-xl space-y-6" data-testid="public-install-offer">
              <div>
                <div className="overline text-muted-foreground">Alternative date available</div>
                <h1 className="mt-2 font-display text-3xl sm:text-4xl">Your requested date is taken</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  We have an open installation date ready for you. Accept it below to confirm the appointment.
                </p>
              </div>
              <div className="border-l-4 border-[#D97706] bg-[#D97706]/10 p-5">
                <div className="overline text-muted-foreground">Open installation date</div>
                <div className="mt-2 font-mono text-2xl font-semibold" data-testid="public-install-offered-date">
                  {info.offered_date} · {info.offered_time}
                </div>
                {info.offer_note && <p className="mt-3 text-sm text-muted-foreground">{info.offer_note}</p>}
              </div>
              <label className="block">
                <span className="overline text-muted-foreground">Reply / confirmation note</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  data-testid="public-install-offer-notes"
                  placeholder="Add any notes for the installation team."
                  className="mt-2 w-full border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <Btn
                onClick={acceptOffer}
                disabled={busy}
                data-testid="public-install-accept-offer"
                className="w-full justify-center bg-[#16A34A] hover:bg-[#166534] text-white"
              >
                {busy ? "Accepting…" : "Accept this date"}
              </Btn>
            </div>
          )}

          {!error && info && !done && !offerAccepted && info.status === "sent" && (
            <div className="space-y-7">
              <div className="max-w-2xl">
                <div className="overline text-muted-foreground">Completed decals</div>
                <h1 className="mt-2 font-display text-3xl sm:text-4xl">Choose a tentative installation date</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {info.customer_name} · {info.number}{info.title ? ` · ${info.title}` : ""}
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Please ensure your equipment is cleaned and staged. We will review your request
                  and let you know if the chosen day is open before confirming your appointment.
                </p>
              </div>

              <div className="border border-border bg-[#F8FAFA] p-4 sm:p-6">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium">
                  <CalendarCheck size={18} weight="bold" className="text-[#15803D]" />
                  Select Monday–Thursday for morning or afternoon, or Friday morning.
                </div>
                <div className="grid gap-6 lg:grid-cols-3">
                  {months.map((month) => {
                    const year = month.getUTCFullYear();
                    const monthIndex = month.getUTCMonth();
                    return (
                      <div key={`${year}-${monthIndex}`} data-testid={`public-install-month-${year}-${monthIndex + 1}`}>
                        <div className="mb-3 text-center font-display text-lg">{MONTHS[monthIndex]} {year}</div>
                        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-muted-foreground">
                          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
                        </div>
                        <div className="mt-1 grid grid-cols-7 gap-1">
                          {monthCells(month).map((day, index) => {
                            if (!day) return <div key={`empty-${index}`} className="aspect-square" />;
                            const dateKey = toDateKey(year, monthIndex, day);
                            const allowed = isAllowed(dateKey);
                            const selected = selectedDate === dateKey;
                            return (
                              <button
                                key={dateKey}
                                type="button"
                                disabled={!allowed}
                                onClick={() => chooseDate(dateKey)}
                                data-testid={`public-install-date-${dateKey}`}
                                className={`aspect-square border text-sm transition-colors ${
                                  selected
                                    ? "border-[#15803D] bg-[#16A34A] text-white"
                                    : allowed
                                      ? "border-border bg-card hover:border-[#15803D] hover:bg-[#16A34A]/10"
                                      : "cursor-not-allowed border-transparent text-muted-foreground/30"
                                }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <div>
                  <div className="overline text-muted-foreground">Preferred time</div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTimeOfDay("morning")}
                      data-testid="public-install-morning"
                      className={`border px-4 py-3 text-left text-sm ${timeOfDay === "morning" ? "border-[#15803D] bg-[#16A34A]/10" : "border-border"}`}
                    >
                      <div className="font-medium">Morning</div>
                      <div className="mt-1 text-xs text-muted-foreground">Available Monday–Friday</div>
                    </button>
                    <button
                      type="button"
                      disabled={selectedFriday}
                      onClick={() => setTimeOfDay("afternoon")}
                      data-testid="public-install-afternoon"
                      className={`border px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${timeOfDay === "afternoon" ? "border-[#15803D] bg-[#16A34A]/10" : "border-border"}`}
                    >
                      <div className="font-medium">Afternoon</div>
                      <div className="mt-1 text-xs text-muted-foreground">Available Monday–Thursday</div>
                    </button>
                  </div>
                </div>
                <label className="block">
                  <span className="overline text-muted-foreground">Reply / installation notes</span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    data-testid="public-install-notes"
                    placeholder="Share gate access, vehicle location, preferred contact details, or any other scheduling notes."
                    className="mt-2 w-full border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground" data-testid="public-install-selection">
                  {selectedDate ? `Tentative request: ${selectedDate} · ${timeOfDay}` : "Choose a date to continue"}
                </div>
                <Btn
                  onClick={submit}
                  disabled={busy || !selectedDate}
                  data-testid="public-install-submit"
                  className="justify-center bg-[#15803D] hover:bg-[#166534] text-white"
                >
                  {busy ? "Submitting…" : "Send tentative request"}
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}