"use client"

import { ReactNode, useMemo, useState } from "react"
import { AnimatePresence, MotionConfig, motion } from "framer-motion"
import useMeasure from "react-use-measure"

import { cn } from "@/lib/utils"

type Tab = {
    id: number
    label: string
    content: ReactNode
}

interface OgImageSectionProps {
    tabs: Tab[]
    className?: string
    rounded?: string
    onChange?: () => void
}

function DirectionAwareTabs({
    tabs,
    className,
    rounded,
    onChange,
}: OgImageSectionProps) {
    const [activeTab, setActiveTab] = useState(0)
    const [direction, setDirection] = useState(0)
    const [isAnimating, setIsAnimating] = useState(false)
    const [ref, bounds] = useMeasure()

    const content = useMemo(() => {
        const activeTabContent = tabs.find((tab) => tab.id === activeTab)?.content
        return activeTabContent || null
    }, [activeTab, tabs])

    const handleTabClick = (newTabId: number) => {
        if (newTabId !== activeTab && !isAnimating) {
            const newDirection = newTabId > activeTab ? 1 : -1
            setDirection(newDirection)
            setActiveTab(newTabId)
            onChange ? onChange() : null
        }
    }

    const variants = {
        initial: (direction: number) => ({
            x: 300 * direction,
            opacity: 0,
            filter: "blur(4px)",
        }),
        active: {
            x: 0,
            opacity: 1,
            filter: "blur(0px)",
        },
        exit: (direction: number) => ({
            x: -300 * direction,
            opacity: 0,
            filter: "blur(4px)",
        }),
    }

    return (
        <div className=" flex flex-col items-center w-full">
            <div
                className={cn(
                    "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
                    className,
                    rounded
                )}
            >
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => handleTabClick(tab.id)}
                        className={cn(
                            // "relative rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-medium text-neutral-200  transition focus-visible:outline-1 focus-visible:ring-1  focus-visible:outline-none flex gap-2 items-center ",
                            "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
                            activeTab === tab.id
                                ? "text-white bg-background text-foreground shadow-sm"
                                : "text-neutral-300/60  hover:text-neutral-200/80",
                            rounded
                        )}
                        style={{ WebkitTapHighlightColor: "transparent" }}
                    >
                        {/* {activeTab !== tab.id && (
                            <motion.span
                                layoutId="bubble"
                                // className="absolute  inset-0 z-10 bg-neutral-700 mix-blend-difference shadow-inner-shadow border border-white/10"
                                className="bg-background text-foreground shadow-sm"
                                style={rounded ? { borderRadius: 9 } : { borderRadius: 9999 }}
                                transition={{ type: "spring", bounce: 0.19, duration: 0.4 }}
                            />
                        )} */}

                        {tab.label}
                    </button>
                ))}
            </div>
            <MotionConfig transition={{ duration: 0.4, type: "spring", bounce: 0.2 }}>
                <motion.div
                    className="relative mx-auto w-full h-full overflow-hidden"
                    initial={false}
                    animate={{ height: bounds.height }}
                >
                    <div className="p-1" ref={ref}>
                        <AnimatePresence
                            custom={direction}
                            mode="popLayout"
                            onExitComplete={() => setIsAnimating(false)}
                        >
                            <motion.div
                                key={activeTab}
                                variants={variants}
                                initial="initial"
                                animate="active"
                                exit="exit"
                                custom={direction}
                                onAnimationStart={() => setIsAnimating(true)}
                                onAnimationComplete={() => setIsAnimating(false)}
                            >
                                {content}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>
            </MotionConfig>
        </div>
    )
}
export { DirectionAwareTabs }